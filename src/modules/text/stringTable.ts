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
  private firstEntries = new Map<string, StringTableEntry>();

  constructor(private sourceText: string) {
    this.rebuild(sourceText);
  }

  get source(): string { return this.sourceText; }
  get sha256(): string { return createHash("sha256").update(this.sourceText, "utf8").digest("hex"); }

  clone(): StringTableDocument { return new StringTableDocument(this.sourceText); }

  private rebuild(source: string): void {
    this.sourceText = source;
    this.entries = [];
    this.firstEntries.clear();
    let offset = 0;
    const lines = source.match(/.*(?:\r\n|\n|$)/g) ?? [];
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      if (!raw) continue;
      const contentLength = raw.replace(/(?:\r\n|\n)$/, "").length;
      const content = raw.slice(0, contentLength);
      if (!content.trim() || /^\s*(?:#|\/\/)/.test(content)) {
        offset += raw.length;
        continue;
      }
      const equals = content.indexOf("=");
      if (equals <= 0) {
        offset += raw.length;
        continue;
      }
      const rawKey = content.slice(0, equals);
      const key = rawKey.trim();
      if (!key) {
        offset += raw.length;
        continue;
      }
      const leadingValue = content.slice(equals + 1).match(/^\s*/)?.[0].length ?? 0;
      const entry = {
        key,
        value: content.slice(equals + 1 + leadingValue),
        line: index + 1,
        start: offset,
        end: offset + raw.length,
        valueStart: offset + equals + 1 + leadingValue,
        valueEnd: offset + contentLength,
      };
      this.entries.push(entry);
      if (!this.firstEntries.has(key)) this.firstEntries.set(key, entry);
      offset += raw.length;
    }
  }

  list(search?: string, limit = 200): StringTableEntry[] {
    const needle = search?.toLowerCase();
    return this.entries.filter((entry) => !needle || entry.key.toLowerCase().includes(needle) || entry.value.toLowerCase().includes(needle)).slice(0, limit).map((entry) => ({ ...entry }));
  }

  get(key: string): StringTableEntry | undefined {
    const entry = this.firstEntries.get(key);
    return entry ? { ...entry } : undefined;
  }

  set(key: string, value: string): void {
    if (!key || /[\r\n=]/.test(key)) throw new Error("Invalid string-table key");
    if (/[\r\n]/.test(value)) throw new Error("String-table values must encode new lines as <n/>");
    const entry = this.firstEntries.get(key);
    if (entry) {
      this.rebuild(
        this.sourceText.slice(0, entry.valueStart) + value + this.sourceText.slice(entry.valueEnd),
      );
      return;
    }
    const nl = newlineOf(this.sourceText);
    const prefix = this.sourceText.length && !this.sourceText.endsWith("\n") ? nl : "";
    this.rebuild(`${this.sourceText}${prefix}${key}=${value}${nl}`);
  }

  /** Consecutive sets preserve first-duplicate and accumulated whitespace
   * behavior while patching/reparsing the table once. Unusual noncanonical
   * keys and line separators retain the original sequential writer.
   */
  setMany(changes: readonly { key: string; value: string }[]): void {
    for (const { key, value } of changes) {
      if (!key || /[\r\n=]/.test(key)) throw new Error("Invalid string-table key");
      if (/[\r\n]/.test(value))
        throw new Error("String-table values must encode new lines as <n/>");
    }
    if (!changes.length) return;
    if (
      /[\u2028\u2029]/.test(this.sourceText) ||
      changes.some(
        (c) =>
          c.key.trim() !== c.key ||
          /^(?:#|\/\/)/.test(c.key) ||
          /[\u2028\u2029]/.test(c.key + c.value),
      )
    ) {
      for (const { key, value } of changes) this.set(key, value);
      return;
    }
    const replacements = new Map<string, string>();
    for (const { key, value } of changes) {
      const previous = replacements.get(key);
      replacements.set(
        key,
        previous === undefined ? value : (previous.match(/^\s*/)?.[0] ?? "") + value,
      );
    }
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const appended: string[] = [];
    for (const [key, value] of replacements) {
      const entry = this.firstEntries.get(key);
      if (entry) edits.push({ start: entry.valueStart, end: entry.valueEnd, text: value });
      else appended.push(`${key}=${value}`);
    }
    let cursor = 0;
    const parts: string[] = [];
    for (const edit of edits.sort((a, b) => a.start - b.start)) {
      parts.push(this.sourceText.slice(cursor, edit.start), edit.text);
      cursor = edit.end;
    }
    parts.push(this.sourceText.slice(cursor));
    if (appended.length) {
      const nl = newlineOf(this.sourceText);
      if (this.sourceText.length && !this.sourceText.endsWith("\n")) parts.push(nl);
      parts.push(appended.join(nl), nl);
    }
    this.rebuild(parts.join(""));
  }

  remove(key: string): void {
    const entry = this.firstEntries.get(key);
    if (!entry) throw new Error(`Text key not found: ${key}`);
    this.rebuild(this.sourceText.slice(0, entry.start) + this.sourceText.slice(entry.end));
  }
}
