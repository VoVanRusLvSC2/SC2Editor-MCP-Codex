import type { CutsceneTime } from "./types.js";

function normalizeDecimal(input: string): string {
  const negative = input.startsWith("-");
  const body = negative ? input.slice(1) : input;
  const [wholeRaw, fractionRaw = ""] = body.split(".");
  const whole = (wholeRaw || "0").replace(/^0+(?=\d)/, "");
  const fraction = fractionRaw.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function millisecondsToSeconds(value: string): string {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, "");
  const padded = digits.padStart(4, "0");
  const whole = padded.slice(0, -3);
  const fraction = padded.slice(-3);
  return normalizeDecimal(`${negative ? "-" : ""}${whole}.${fraction}`);
}

export function parseCutsceneTime(input: string | number): CutsceneTime {
  const raw = String(input).trim();
  if (/^-?\d+(?:\.\d+)?ms$/i.test(raw)) {
    const ms = raw.slice(0, -2);
    if (ms.includes(".")) {
      const numeric = Number(ms) / 1000;
      if (!Number.isFinite(numeric)) throw new Error(`Invalid time '${raw}'`);
      return { input: raw, unit: "milliseconds", decimalSeconds: normalizeDecimal(String(numeric)) };
    }
    return { input: raw, unit: "milliseconds", decimalSeconds: millisecondsToSeconds(ms) };
  }
  if (/^-?\d+(?:\.\d+)?s$/i.test(raw)) {
    return { input: raw, unit: "seconds", decimalSeconds: normalizeDecimal(raw.slice(0, -1)) };
  }
  const timecode = raw.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (timecode) {
    if(Number(timecode[2])>59 || Number(timecode[3])>59) throw new Error(`Invalid timecode ${raw}: minutes and seconds must be 00..59`);
    const seconds = BigInt(timecode[1]) * 3600n + BigInt(timecode[2]) * 60n + BigInt(timecode[3]);
    const fraction = timecode[4]?.replace(/0+$/, "") ?? "";
    return { input: raw, unit: "timecode", decimalSeconds: `${seconds}${fraction ? `.${fraction}` : ""}` };
  }
  if (/^-?\d+$/.test(raw)) return { input: raw, unit: "native", nativeValue: raw };
  if (/^-?\d+\.\d+$/.test(raw)) return { input: raw, unit: "seconds", decimalSeconds: normalizeDecimal(raw) };
  throw new Error(`Invalid time '${raw}'. Use native ticks, 125ms, 1.5s, or 00:00:12.500.`);
}

export function compareDecimalTime(a: string, b: string): number {
  const scale = Math.max(a.split(".")[1]?.length ?? 0, b.split(".")[1]?.length ?? 0);
  const toScaled = (value: string): bigint => {
    const negative = value.startsWith("-");
    const body = negative ? value.slice(1) : value;
    const [whole, fraction = ""] = body.split(".");
    const result = BigInt((whole || "0") + fraction.padEnd(scale, "0"));
    return negative ? -result : result;
  };
  const left = toScaled(a);
  const right = toScaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

