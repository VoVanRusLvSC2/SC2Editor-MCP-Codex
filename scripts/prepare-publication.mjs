// Copyright (c) 2026, VoVanRusLvSC2 <vladimir.lencmanis@gmail.com>
// SPDX-License-Identifier: LicenseRef-SC2Editor-MCP-Attribution-1.0
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicationRoot = path.join(root, "work", "publication");
execFileSync(process.execPath, [path.join(root, "scripts", "audit-publication.mjs")], { cwd: root, stdio: "pipe" });
const audit = JSON.parse(await fs.readFile(path.join(publicationRoot, "audit.json"), "utf8"));
if (audit.missingRequiredFiles.length || audit.gitInventoryError) throw new Error("PUBLICATION_INVENTORY_INCOMPLETE");
const payload = await fs.mkdtemp(path.join(publicationRoot, "source-package-"));
const selected = audit.files.filter(record => ["candidate", "review"].includes(record.category));
const hashes = [];
const seen = new Set();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function contained(base, file) {
  const absolute = path.resolve(base, file), relative = path.relative(base, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
    throw new Error(`PUBLICATION_PATH_OUTSIDE_ROOT: ${file}`);
  return absolute;
}
for (const record of selected) {
  const key = record.file.toLowerCase();
  if (seen.has(key)) throw new Error(`PUBLICATION_CASE_COLLISION: ${record.file}`);
  seen.add(key);
  const source = contained(root, record.file), target = contained(payload, record.file);
  if (!(await fs.lstat(source)).isFile()) throw new Error(`PUBLICATION_NOT_REGULAR_FILE: ${record.file}`);
  const bytes = await fs.readFile(source);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes, { flag: "wx" });
  const copied = await fs.readFile(target);
  if (!bytes.equals(copied)) throw new Error(`PUBLICATION_COPY_MISMATCH: ${record.file}`);
  hashes.push({ file: record.file, bytes: copied.length, sha256: digest(copied), category: record.category });
}
const notices = ["LICENSE", "CREDITS.md", "THIRD_PARTY_LICENSES.md", "vendor/blizzard-models/LICENSE-GPL-2.0.txt",
  "vendor/blizzard-models/NOTICE.md", "vendor/modkit-scene/NOTICE.md", "vendor/modkit-scene/LICENSE-MIT.txt", "src/modules/terrain/surface/NOTICE.md",
  "native/vendor/StormLib/LICENSE", "native/casc/LICENSE-CascLib.txt", "generated/TIKTOKEN_LICENSE.txt"];
for (const notice of notices) if (!seen.has(notice.toLowerCase())) throw new Error(`PUBLICATION_NOTICE_MISSING: ${notice}`);
const report = {
  schemaVersion: 1, createdAt: new Date().toISOString(), payload,
  preparedForReview: true, readyForPublicPush: audit.readyForPublicPush,
  files: hashes.length, bytes: hashes.reduce((sum, record) => sum + record.bytes, 0),
  allCopiesByteVerified: true, noticesPreserved: notices,
  publicationHolds: audit.publicationHolds,
  sourceGitTrackedFilesOutsidePayload: audit.trackedLocalFiles.length,
  limitations: ["Local source proposal only; no commit, index change or push", "No private game fixtures or asset-embedded players", "Not a standalone binary distribution; npm dependencies and native helpers must be installed/built", "Publication holds and past Git history need resolution before public push"],
  inventory: hashes
};
const reportFile = path.join(publicationRoot, "prepare.json");
await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ payload, report: reportFile, preparedForReview: true, readyForPublicPush: report.readyForPublicPush, files: report.files, bytes: report.bytes, allCopiesByteVerified: true, noticesPreserved: notices.length }, null, 2)}\n`);
