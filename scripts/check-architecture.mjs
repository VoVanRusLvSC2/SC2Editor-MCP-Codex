/* global process */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export function emittedDependencies(file, source) {
  const emitted = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ast = ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true);
  const imports = [];
  for (const node of ast.statements) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith("."))
        imports.push(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(file), specifier.replace(/\.js$/, ".ts")),
          ),
        );
    }
  }
  return imports;
}

export function dependencyCycles(graph) {
  const indices = new Map(),
    lows = new Map(),
    stack = [],
    active = new Set(),
    cycles = [];
  let sequence = 0;
  function visit(node) {
    indices.set(node, sequence);
    lows.set(node, sequence++);
    stack.push(node);
    active.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!graph.has(target)) continue;
      if (!indices.has(target)) {
        visit(target);
        lows.set(node, Math.min(lows.get(node), lows.get(target)));
      } else if (active.has(target)) lows.set(node, Math.min(lows.get(node), indices.get(target)));
    }
    if (lows.get(node) !== indices.get(node)) return;
    const component = [];
    let entry;
    do {
      entry = stack.pop();
      active.delete(entry);
      component.push(entry);
    } while (entry !== node);
    if (component.length > 1 || graph.get(node)?.includes(node)) cycles.push(component.sort());
  }
  for (const node of graph.keys()) if (!indices.has(node)) visit(node);
  return cycles;
}

export async function checkArchitecture(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const file = directory + "/" + entry.name;
      if (entry.isDirectory()) {
        if (file !== "src/tests") await walk(file);
      } else if (entry.isFile() && file.endsWith(".ts")) files.push(file);
    }
  }
  await walk("src");
  const graph = new Map();
  for (const file of files.sort())
    graph.set(file, emittedDependencies(file, await fs.readFile(path.join(root, file), "utf8")));
  const violations = [];
  const boundaries = {
    "src/app/telemetry.ts": [],
    "src/modules/assets/transform.ts": [],
    "src/modules/data/effectiveData.ts": ["src/modules/data/parentClasses.ts"],
    "src/modules/trigger/xmlFragments.ts": [
      "src/core/xmlScanner.ts",
      "src/modules/trigger/typeSystem.ts",
    ],
  };
  for (const [file, allowed] of Object.entries(boundaries))
    for (const target of graph.get(file) ?? [])
      if (!allowed.includes(target)) violations.push({ file, target });
  const cycles = dependencyCycles(graph);
  return {
    ok: !cycles.length && !violations.length,
    files: files.length,
    cycles,
    violations,
    scope:
      "Static relative value imports/re-exports after TypeScript type erasure; excludes dynamic imports and external runtimes.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await checkArchitecture(process.cwd());
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) process.exitCode = 1;
}
