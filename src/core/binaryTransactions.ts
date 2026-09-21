import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { commitFiles, TransactionQueue } from "./fileTransactions.js";

export const bytesHash = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export interface ByteSnapshot {
  file: string;
  bytes: Buffer;
  exists: boolean;
  staged: boolean;
}
export interface ByteOptions {
  dryRun?: boolean;
  stage?: boolean;
  backup?: boolean;
  requireMissing?: boolean;
  expectedSha256?: Record<string, string>;
  verify?: () => Promise<void>;
}
interface DraftGroup {
  id: string;
  files: string[];
  bytes: Map<string, Buffer>;
  diskHash: Record<string, string>;
  diskExists: Record<string, boolean>;
  verify?: () => Promise<void>;
}

/** Byte-preserving counterpart to raw XML transactions. A staged group is committed together. */
export class BinaryTransactions {
  private groups = new Map<string, DraftGroup>();
  private owners = new Map<string, string>();
  private commits = new Map<
    string,
    { originals: Map<string, ByteSnapshot>; afterHash: Record<string, string> }
  >();
  private revision = 0;
  constructor(
    readonly root: string,
    private resolve: (file: string) => string,
    private textDraft: (file: string) => string | undefined,
    private clearTextDraft: (file: string) => void,
    private queue = new TransactionQueue(),
    private textGuard: (files: string[]) => void = () => {},
  ) {}
  key(file: string): string {
    return path.relative(this.root, this.resolve(file)).replaceAll("\\", "/");
  }
  hasDraft(file: string): boolean {
    return this.owners.has(this.key(file));
  }
  draftFiles(): string[] { return [...this.owners.keys()]; }
  assertNoDraft(files: string[]): void {
    for (const file of files)
      if (this.hasDraft(file))
        throw new Error(
          `BINARY_TRANSACTION_STAGED: ${file}; save or discard its terrain transaction first`,
        );
  }
  async read(file: string, includeDraft = true): Promise<ByteSnapshot> {
    const key = this.key(file);
    let bytes: Buffer;
    let exists = true;
    try {
      bytes = await fs.readFile(this.resolve(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      exists = false;
      bytes = Buffer.alloc(0);
    }
    const owner = includeDraft ? this.owners.get(key) : undefined;
    const draft = owner ? this.groups.get(owner)?.bytes.get(key) : undefined;
    const text = includeDraft ? this.textDraft(key) : undefined;
    return {
      file: key,
      bytes: Buffer.from(
        draft ?? (text === undefined ? bytes : Buffer.from(text)),
      ),
      exists,
      staged: draft !== undefined || text !== undefined,
    };
  }
  async stagedText(file: string): Promise<string | undefined> {
    if (!this.hasDraft(file)) return undefined;
    const bytes = (await this.read(file)).bytes;
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes))
      throw new Error(
        `BINARY_COMPONENT: ${file}; use terrain tools instead of XML tools`,
      );
    return text;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { return this.queue.run(work); }
  apply(
    files: string[],
    transform: (
      sources: ReadonlyMap<string, Buffer>,
    ) => Map<string, Buffer> | Promise<Map<string, Buffer>>,
    options: ByteOptions = {},
  ) {
    return this.serial(() => this.perform(files, transform, options));
  }
  private async perform(
    files: string[],
    transform: (
      sources: ReadonlyMap<string, Buffer>,
    ) => Map<string, Buffer> | Promise<Map<string, Buffer>>,
    options: ByteOptions & { removeFiles?: string[] },
  ) {
    const keys = [...new Set(files.map((file) => this.key(file)))];
    if (!keys.length || keys.length > 64)
      throw new Error("Binary transaction requires 1..64 files");
    for (const key of keys) {
      const owner = this.owners.get(key);
      if (owner && this.groups.get(owner)!.files.some((f) => !keys.includes(f)))
        throw new Error(
          "PARTIAL_BINARY_TRANSACTION: include the entire staged group",
        );
    }
    const verifications = new Set(keys.flatMap(key => {
      const owner = this.owners.get(key), verify = owner ? this.groups.get(owner)?.verify : undefined;
      return verify ? [verify] : [];
    }));
    if(options.verify) verifications.add(options.verify);
    const verify = async () => { for(const check of verifications) await check(); };
    this.textGuard(keys);
    await verify();
    const revision = this.revision;
    const guard = () => { if (revision !== this.revision) throw new Error("STALE_BINARY_DRAFT: draft changed during transaction"); this.textGuard(keys); };
    const disk = new Map<string, ByteSnapshot>();
    const current = new Map<string, Buffer>();
    for (const key of keys) {
      const d = await this.read(key, false);
      const owner = this.owners.get(key);
      if (owner && (this.groups.get(owner)!.diskHash[key] !== bytesHash(d.bytes) || this.groups.get(owner)!.diskExists[key] !== d.exists)) throw new Error(`STALE_BINARY_TRANSACTION: ${key}`);
      if (options.requireMissing && (d.exists || this.hasDraft(key))) throw new Error(`Target already exists: ${key}`);
      disk.set(key, d);
      current.set(key, Buffer.from(owner ? this.groups.get(owner)!.bytes.get(key)! : d.bytes));
      if (
        options.expectedSha256?.[key] &&
        options.expectedSha256[key] !== bytesHash(d.bytes)
      )
        throw new Error(`STALE_BINARY_TRANSACTION: ${key}`);
    }
    const transformed = await transform(
      new Map([...current].map(([k, v]) => [k, Buffer.from(v)])),
    );
    for (const [key, bytes] of transformed)
      if (!keys.includes(key) || !Buffer.isBuffer(bytes))
        throw new Error(`Invalid binary transaction output: ${key}`);
    const next = new Map(
      keys.map((k) => [k, Buffer.from(transformed.get(k) ?? current.get(k)!)]),
    );
    const dryRun = options.dryRun ?? true;
    const stage = options.stage ?? true;
    const removals = new Set(options.removeFiles ?? []);
    if (stage && removals.size)
      throw new Error(
        "Deletion cannot be staged through this internal restoration path",
      );
    const changed = keys.filter(
      (k) =>
        !next.get(k)!.equals(stage ? current.get(k)! : disk.get(k)!.bytes) ||
        (removals.has(k) && disk.get(k)!.exists) || (options.requireMissing && !disk.get(k)!.exists),
    );
    const diskHash = Object.fromEntries(
      keys.map((k) => [k, bytesHash(disk.get(k)!.bytes)]),
    );
    // Catch external edits while transform/validation was running, before any write.
    for (const key of keys) {
      const snapshot = await this.read(key, false);
      if (bytesHash(snapshot.bytes) !== diskHash[key] || snapshot.exists !== disk.get(key)!.exists) throw new Error(`STALE_BINARY_TRANSACTION: ${key}`);
    }
    guard();
    await verify(); guard();
    let transactionId: string | undefined;
    if (!dryRun && (changed.length || keys.some((k) => this.hasDraft(k)))) {
      if (stage) {
        transactionId = `bytes_${randomUUID()}`;
        for (const id of new Set(
          keys.flatMap((k) =>
            this.owners.get(k) ? [this.owners.get(k)!] : [],
          ),
        ))
          this.removeGroup(id);
        this.groups.set(transactionId, {
          id: transactionId,
          files: keys,
          bytes: next,
          diskHash,
          diskExists: Object.fromEntries(keys.map(key => [key, disk.get(key)!.exists])),
          verify: verifications.size ? verify : undefined,
        });
        for (const key of keys) this.owners.set(key, transactionId);
        this.revision++;
      } else {
        transactionId = `bytes_${randomUUID()}`;
        await commitFiles(file => this.resolve(file), disk, new Map(changed.map(key => [key, next.get(key)!])), { backup: options.backup, removeFiles: removals, guard, verify,journalRoot:this.root });
        this.commits.set(transactionId, {
          originals: new Map(changed.map((k) => [k, disk.get(k)!])),
          afterHash: Object.fromEntries(
            changed.map((k) => [k, bytesHash(next.get(k)!)]),
          ),
        });
        while (this.commits.size > 8)
          this.commits.delete(this.commits.keys().next().value!);
        for (const id of new Set(
          keys.flatMap((k) =>
            this.owners.get(k) ? [this.owners.get(k)!] : [],
          ),
        ))
          this.removeGroup(id);
        for (const key of keys) this.clearTextDraft(key);
      }
    }
    return {
      accepted: true,
      dryRun,
      staged: !dryRun && stage,
      saved: !dryRun && !stage,
      transactionId,
      files: keys.map((file) => ({
        file,
        changed: !current.get(file)!.equals(next.get(file)!),
        diskChanged: !disk.get(file)!.bytes.equals(next.get(file)!),
        beforeSha256: bytesHash(disk.get(file)!.bytes),
        afterSha256: bytesHash(next.get(file)!),
        beforeBytes: current.get(file)!.length,
        afterBytes: next.get(file)!.length,
      })),
    };
  }
  private removeGroup(id: string): void {
    const group = this.groups.get(id);
    if (group) for (const file of group.files) this.owners.delete(file);
    if (this.groups.delete(id)) this.revision++;
  }
  async save(id: string, options: Omit<ByteOptions, "stage"> = {}) {
    return this.serial(async () => {
      const group = this.groups.get(id);
      if (!group) throw new Error(`Staged binary transaction not found: ${id}`);
      const result = await this.perform(
        group.files,
        () => new Map(group.bytes),
        {
          ...options,
          stage: false,
          expectedSha256: { ...group.diskHash, ...options.expectedSha256 },
          verify: options.verify,
        },
      );
      if (!result.dryRun && result.transactionId) {
        const commit = this.commits.get(result.transactionId);
        if (commit) {
          this.commits.delete(result.transactionId);
          this.commits.set(id, commit);
        }
        result.transactionId = id;
      }
      return result;
    });
  }
  rollback(id: string, dryRun = true) {
    return this.serial(async () => {
      if (this.groups.has(id))
        return { ...this.discard(id, dryRun), mode: "discard-staged" };
      const commit = this.commits.get(id);
      if (!commit)
        throw new Error(`Binary transaction journal not found: ${id}`);
      const keys = [...commit.originals.keys()];
      if (!keys.length)
        return { rolledBack: false, dryRun, files: [], mode: "no-changes" };
      const result = await this.perform(
        keys,
        () => new Map([...commit.originals].map(([f, s]) => [f, s.bytes])),
        {
          dryRun,
          stage: false,
          backup: false,
          expectedSha256: commit.afterHash,
          removeFiles: [...commit.originals]
            .filter(([, s]) => !s.exists)
            .map(([f]) => f),
        },
      );
      if (!dryRun) this.commits.delete(id);
      return {
        rolledBack: !dryRun,
        discarded: !dryRun,
        dryRun,
        mode: "restore-committed-bytes",
        transaction: result,
        files: keys,
      };
    });
  }
  discard(fileOrId: string, dryRun = true) {
    const id = this.groups.has(fileOrId)
      ? fileOrId
      : this.owners.get(this.key(fileOrId));
    const group = id ? this.groups.get(id) : undefined;
    if (!group) return { discarded: false, dryRun, files: [] as string[] };
    const files = [...group.files];
    if (!dryRun) this.removeGroup(group.id);
    return { discarded: !dryRun, dryRun, files };
  }
}
