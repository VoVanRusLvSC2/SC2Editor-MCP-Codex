import { promises as fs } from "node:fs";
import path from "node:path";

export interface FontAsset {
  name: string;
  path: string;
  format: "TTF" | "OTF";
  dependency: string;
  exists: boolean;
  confidence: "CONFIRMED_FILE" | "OBSERVED_REFERENCE";
}

async function walk(root: string, output: FontAsset[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(full, output);
    else if (/\.(?:ttf|otf)$/i.test(entry.name)) output.push({
      name: path.basename(entry.name, path.extname(entry.name)),
      path: full,
      format: path.extname(entry.name).toLowerCase() === ".otf" ? "OTF" : "TTF",
      dependency: "workspace",
      exists: true,
      confidence: "CONFIRMED_FILE",
    });
  }
}

export class FontAssetIndex {
  constructor(private readonly root: string, private readonly observedPaths: string[] = []) {}

  async search(query?: string, limit = 50): Promise<FontAsset[]> {
    const files: FontAsset[] = [];
    await walk(this.root, files);
    for (const nativePath of this.observedPaths) {
      const base = nativePath.replaceAll("\\", "/").split("/").at(-1) ?? nativePath;
      if (files.some((entry) => entry.path.toLowerCase().endsWith(nativePath.replaceAll("\\", path.sep).toLowerCase()))) continue;
      files.push({
        name: path.basename(base, path.extname(base)),
        path: nativePath,
        format: path.extname(base).toLowerCase() === ".otf" ? "OTF" : "TTF",
        dependency: "Core.SC2Mod",
        exists: false,
        confidence: "OBSERVED_REFERENCE",
      });
    }
    const needle = query?.toLowerCase();
    return files.filter((entry) => !needle || entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle)).slice(0, limit);
  }
}
