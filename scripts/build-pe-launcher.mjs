import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";

const FILE_ALIGNMENT = 0x200;
const SECTION_ALIGNMENT = 0x1000;
const TEXT_RVA = 0x1000;
const IDATA_RVA = 0x2000;

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function makeImports(names) {
  const data = Buffer.alloc(FILE_ALIGNMENT);
  const intOffset = 0x40;
  const iatOffset = align(intOffset + (names.length + 1) * 8, 8);
  let cursor = align(iatOffset + (names.length + 1) * 8, 2);
  const dllOffset = cursor;
  cursor += data.write("KERNEL32.dll\0", cursor, "ascii");
  cursor = align(cursor, 2);
  const hintOffsets = new Map();
  for (const name of names) {
    const offset = cursor;
    data.writeUInt16LE(0, cursor);
    cursor += 2;
    cursor += data.write(`${name}\0`, cursor, "ascii");
    cursor = align(cursor, 2);
    hintOffsets.set(name, offset);
  }
  names.forEach((name, index) => {
    const value = BigInt(IDATA_RVA + hintOffsets.get(name));
    data.writeBigUInt64LE(value, intOffset + index * 8);
    data.writeBigUInt64LE(value, iatOffset + index * 8);
  });
  data.writeUInt32LE(IDATA_RVA + intOffset, 0);
  data.writeUInt32LE(IDATA_RVA + dllOffset, 12);
  data.writeUInt32LE(IDATA_RVA + iatOffset, 16);
  return {
    data,
    used: cursor,
    iatRva: Object.fromEntries(names.map((name, index) => [name, IDATA_RVA + iatOffset + index * 8])),
    iatOffset,
    iatSize: (names.length + 1) * 8,
  };
}

function makeCode(iatRva) {
  const bytes = [];
  const labels = new Map();
  const fixups = [];
  const emit = (...values) => bytes.push(...values);
  const label = (name) => labels.set(name, bytes.length);
  const rel32 = (kind, target) => {
    if (kind === "call") emit(0xff, 0x15);
    else if (kind === "lea") emit(0x48, 0x8d, 0x0d);
    else if (kind === "jmp") emit(0xe9);
    else if (kind === "jz") emit(0x0f, 0x84);
    else if (kind === "jb") emit(0x0f, 0x82);
    const at = bytes.length;
    emit(0, 0, 0, 0);
    fixups.push({ at, target });
  };

  emit(0x48, 0x81, 0xec, 0x28, 0x02, 0x00, 0x00); // sub rsp, 0x228
  emit(0x31, 0xc9); // xor ecx, ecx
  emit(0x48, 0x8d, 0x54, 0x24, 0x20); // lea rdx, [rsp+0x20]
  emit(0x41, 0xb8, 0x04, 0x01, 0x00, 0x00); // mov r8d, 260
  rel32("call", iatRva.GetModuleFileNameW);
  emit(0x85, 0xc0); // test eax, eax
  rel32("jz", "launch");
  emit(0x48, 0x8d, 0x54, 0x24, 0x20); // lea rdx, [rsp+0x20]
  emit(0x4c, 0x8d, 0x4c, 0x42, 0xfe); // lea r9, [rdx+rax*2-2]
  label("scan");
  emit(0x49, 0x39, 0xd1); // cmp r9, rdx
  rel32("jb", "launch");
  emit(0x66, 0x41, 0x83, 0x39, 0x5c); // cmp word [r9], '\\'
  rel32("jz", "found");
  emit(0x49, 0x83, 0xe9, 0x02); // sub r9, 2
  rel32("jmp", "scan");
  label("found");
  emit(0x66, 0x41, 0xc7, 0x01, 0x00, 0x00); // mov word [r9], 0
  emit(0x48, 0x89, 0xd1); // mov rcx, rdx
  rel32("call", iatRva.SetCurrentDirectoryW);
  label("launch");
  rel32("lea", "command");
  emit(0xba, 0x01, 0x00, 0x00, 0x00); // mov edx, SW_SHOWNORMAL
  rel32("call", iatRva.WinExec);
  emit(0x31, 0xc9); // xor ecx, ecx
  rel32("call", iatRva.ExitProcess);
  label("command");
  emit(...Buffer.from('powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "SC2-UI-Workbench.ps1"\0', "ascii"));

  const code = Buffer.from(bytes);
  for (const fixup of fixups) {
    const targetOffset = typeof fixup.target === "number" ? fixup.target - TEXT_RVA : labels.get(fixup.target);
    if (targetOffset === undefined) throw new Error(`Unknown PE fixup target: ${fixup.target}`);
    const displacement = targetOffset - (fixup.at + 4);
    code.writeInt32LE(displacement, fixup.at);
  }
  return code;
}

export async function buildPeLauncher(outputFile) {
  const imports = makeImports(["GetModuleFileNameW", "SetCurrentDirectoryW", "WinExec", "ExitProcess"]);
  const code = makeCode(imports.iatRva);
  if (code.length > FILE_ALIGNMENT) throw new Error("Launcher code exceeds .text raw section");
  const file = Buffer.alloc(0x600);
  file.write("MZ", 0, "ascii");
  file.writeUInt32LE(0x80, 0x3c);
  file.write("This program cannot be run in DOS mode.\r\n$", 0x40, "ascii");
  const pe = 0x80;
  file.write("PE\0\0", pe, "binary");
  const coff = pe + 4;
  file.writeUInt16LE(0x8664, coff);
  file.writeUInt16LE(2, coff + 2);
  file.writeUInt16LE(0xf0, coff + 16);
  file.writeUInt16LE(0x0023, coff + 18); // executable, large-address-aware, relocations stripped
  const optional = coff + 20;
  file.writeUInt16LE(0x20b, optional);
  file.writeUInt8(1, optional + 2);
  file.writeUInt32LE(FILE_ALIGNMENT, optional + 4);
  file.writeUInt32LE(FILE_ALIGNMENT, optional + 8);
  file.writeUInt32LE(TEXT_RVA, optional + 16);
  file.writeUInt32LE(TEXT_RVA, optional + 20);
  file.writeBigUInt64LE(0x140000000n, optional + 24);
  file.writeUInt32LE(SECTION_ALIGNMENT, optional + 32);
  file.writeUInt32LE(FILE_ALIGNMENT, optional + 36);
  file.writeUInt16LE(6, optional + 40);
  file.writeUInt16LE(6, optional + 48);
  file.writeUInt32LE(0x3000, optional + 56);
  file.writeUInt32LE(FILE_ALIGNMENT, optional + 60);
  file.writeUInt16LE(2, optional + 68); // Windows GUI
  file.writeUInt16LE(0x8100, optional + 70); // NX + terminal-server aware; fixed image base
  file.writeBigUInt64LE(0x100000n, optional + 72);
  file.writeBigUInt64LE(0x1000n, optional + 80);
  file.writeBigUInt64LE(0x100000n, optional + 88);
  file.writeBigUInt64LE(0x1000n, optional + 96);
  file.writeUInt32LE(16, optional + 108);
  const directories = optional + 112;
  file.writeUInt32LE(IDATA_RVA, directories + 8);
  file.writeUInt32LE(imports.used, directories + 12);
  file.writeUInt32LE(IDATA_RVA + imports.iatOffset, directories + 12 * 8);
  file.writeUInt32LE(imports.iatSize, directories + 12 * 8 + 4);

  const section = optional + 0xf0;
  file.write(".text\0\0\0", section, "binary");
  file.writeUInt32LE(code.length, section + 8);
  file.writeUInt32LE(TEXT_RVA, section + 12);
  file.writeUInt32LE(FILE_ALIGNMENT, section + 16);
  file.writeUInt32LE(0x200, section + 20);
  file.writeUInt32LE(0x60000020, section + 36);
  const idataSection = section + 40;
  file.write(".idata\0\0", idataSection, "binary");
  file.writeUInt32LE(imports.used, idataSection + 8);
  file.writeUInt32LE(IDATA_RVA, idataSection + 12);
  file.writeUInt32LE(FILE_ALIGNMENT, idataSection + 16);
  file.writeUInt32LE(0x400, idataSection + 20);
  file.writeUInt32LE(0xc0000040, idataSection + 36);
  code.copy(file, 0x200);
  imports.data.copy(file, 0x400);
  await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await fs.writeFile(outputFile, file);
  return { outputFile: path.resolve(outputFile), bytes: file.length, machine: "x86-64", subsystem: "Windows GUI" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ?? "SC2-UI-Workbench.exe";
  process.stdout.write(`${JSON.stringify(await buildPeLauncher(output), null, 2)}\n`);
}
