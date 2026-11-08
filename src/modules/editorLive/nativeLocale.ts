import { liveDigest } from "./identity.js";

export const nativeLocaleLimit = 1024 * 1024;
export interface NativeLocaleEntry {
  file: string;
  key: string;
  value: string;
}

/** Original Export Localized Text format; preserve literal value whitespace and rich text. */
export function parseNativeLocale(source: string): NativeLocaleEntry[] {
  if (Buffer.byteLength(source) > nativeLocaleLimit || source.includes("\0"))
    throw Error("LIVE_LOCALE_SOURCE_BOUND");
  const entries: NativeLocaleEntry[] = [],
    seen = new Set<string>();
  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line) continue;
    const match = line.match(/^\[(LocalizedData\/[A-Za-z][A-Za-z0-9_]*\.txt)\]([^=\r\n]+)=(.*)$/);
    if (!match || match[2].trim() !== match[2]) throw Error("LIVE_LOCALE_FORMAT_UNSUPPORTED");
    const [, file, key, value] = match,
      identity = file + "\0" + key;
    if (seen.has(identity)) throw Error("LIVE_LOCALE_DUPLICATE_KEY");
    seen.add(identity);
    entries.push({ file, key, value });
    if (entries.length > 10000) throw Error("LIVE_LOCALE_ENTRY_BOUND");
  }
  return entries;
}
export function nativeLocaleSignature(source: string) {
  return liveDigest(
    JSON.stringify(
      parseNativeLocale(source).sort((a, b) => {
        const left = a.file + "\0" + a.key,
          right = b.file + "\0" + b.key;
        return left < right ? -1 : left > right ? 1 : 0;
      }),
    ),
  );
}
export function localeComponents(source: string, locale: string) {
  const files = new Map<string, string>();
  for (const { file, key, value } of parseNativeLocale(source)) {
    const path = `${locale}.SC2Data/${file}`;
    files.set(path, (files.get(path) ?? "") + key + "=" + value + "\r\n");
  }
  return files;
}
export function encodeNativeLocale(files: ReadonlyMap<string, string>, locale: string) {
  const prefix = `${locale}.SC2Data/`;
  let result = "";
  for (const [file, source] of files) {
    if (!file.startsWith(prefix)) throw Error("LIVE_LOCALE_COMPONENT_UNSUPPORTED");
    const section = file.slice(prefix.length);
    for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      if (!line) continue;
      result += `[${section}]${line}\r\n`;
    }
  }
  parseNativeLocale(result);
  return result;
}
