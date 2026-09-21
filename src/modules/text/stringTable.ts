import { createHash } from "node:crypto";

export interface StringTableEntry {
  key: string;
  value: string;
  line: number;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
}

function newlineOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

export class StringTableDocument {
  private entries: StringTableEntry[] = [];

  constructor(private sourceText: string) {
    this.rebuild(sourceText);
  }

  get source(): string { return this.sourceText; }
  get sha256(): string { return createHash("sha256").update(this.sourceText, "utf8").digest("hex"); }

  clone(): StringTableDocument { return new StringTableDocument(this.sourceText); }

  private rebuild(source: string): void {
    this.sourceText = source;
    this.entries = [];
    let offset = 0;
    const lines = source.match(/.*(?:\r\n|\n|$)/g) ?? [];
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      if (!raw) continue;
      const contentLength = raw.replace(/(?:\r\n|\n)$/, "").length;
      const content = raw.slice(0, contentLength);
      if (!content.trim() || /^\s*(?:#|\/\/)/.test(content)) { offset += raw.length; continue; }
      const equals = content.indexOf("=");
      if (equals <= 0) { offset += raw.length; continue; }
      const rawKey = content.slice(0, equals);
      const key = rawKey.trim();
      if (!key) { offset += raw.length; continue; }
      const leadingValue = content.slice(equals + 1).match(/^\s*/)?.[0].length ?? 0;
      this.entries.push({
        key,
        value: content.slice(equals + 1 + leadingValue),
        line: index + 1,
        start: offset,
        end: offset + raw.length,
        valueStart: offset + equals + 1 + leadingValue,
        valueEnd: offset + contentLength,
      });
      offset += raw.length;
    }
  }

  list(search?: string, limit = 200): StringTableEntry[] {
    const needle = search?.toLowerCase();
    return this.entries.filter((entry) => !needle || entry.key.toLowerCase().includes(needle) || entry.value.toLowerCase().includes(needle)).slice(0, limit).map((entry) => ({ ...entry }));
  }

  get(key: string): StringTableEntry | undefined {
    const entry = this.entries.find((candidate) => candidate.key === key);
    return entry ? { ...entry } : undefined;
  }

  set(key: string, value: string): void {
    if (!key || /[\r\n=]/.test(key)) throw new Error("Invalid string-table key");
    if (/[\r\n]/.test(value)) throw new Error("String-table values must encode new lines as <n/>");
    const entry = this.entries.find((candidate) => candidate.key === key);
    if (entry) {
      this.rebuild(this.sourceText.slice(0, entry.valueStart) + value + this.sourceText.slice(entry.valueEnd));
      return;
    }
    const nl = newlineOf(this.sourceText);
    const prefix = this.sourceText.length && !this.sourceText.endsWith("\n") ? nl : "";
    this.rebuild(`${this.sourceText}${prefix}${key}=${value}${nl}`);
  }

  remove(key: string): void {
    const entry = this.entries.find((candidate) => candidate.key === key);
    if (!entry) throw new Error(`Text key not found: ${key}`);
    this.rebuild(this.sourceText.slice(0, entry.start) + this.sourceText.slice(entry.end));
  }
}
