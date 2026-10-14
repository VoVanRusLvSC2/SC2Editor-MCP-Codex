import * as z from "zod/v4";
const name = z.string().trim().min(1).max(160).refine(v => !/[\r\n\0]/.test(v) && Buffer.from(v).toString('utf8') === v, "Invalid document name");
const locale = z.enum(["enUS", "ruRU", "deDE", "frFR", "esES", "esMX", "itIT", "koKR", "plPL", "ptBR", "zhCN", "zhTW"]);
export const dependencyEntrySchema = z.object({ file: z.string().min(1).max(260), bnet: z.string().min(1).max(260).optional() }).strict();
export const dependencySchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("standard"), expansion: z.enum(["liberty", "swarm", "void"]).default("void"), campaign: z.boolean().default(false) }).strict(),
    z.object({ mode: z.literal("custom"), entries: z.array(dependencyEntrySchema).max(32) }).strict(),
]);
const dimension = z.number().int().min(32).max(256).refine(v => v % 8 === 0, "Size must be a multiple of 8");
const terrain = z.discriminatedUnion("enabled", [z.object({ enabled: z.literal(false) }).strict(), z.object({ enabled: z.literal(true), tileSet: z.string().min(1).max(128), initialTexture: z.string().min(1).max(128).optional(), baseHeight: z.number().finite().min(0).max(12).default(8) }).strict()]);
const common = { destination: z.string().min(1).max(512), name: name.optional(), locales: z.array(locale).min(1).max(12).refine(v => new Set(v).size === v.length, "Duplicate locales").default(["enUS"]), dependencies: dependencySchema.default({ mode: "standard", expansion: "void", campaign: false }), initialization: z.literal("empty").default("empty") };
export const documentPlanSchema = z.discriminatedUnion("kind", [
    z.object({ ...common, kind: z.literal("mod"), modType: z.enum(["dependent", "extension"]).default("dependent") }).strict(),
    z.object({ ...common, kind: z.literal("map"), mapType: z.literal("arcade").default("arcade"), map: z.object({ width: dimension, height: dimension }).strict(), terrain: terrain.default({ enabled: false }) }).strict(),
]);
export type DependencyRequest = z.infer<typeof dependencySchema>;
export type DependencyEntry = z.infer<typeof dependencyEntrySchema>;
export type DocumentRequest = z.infer<typeof documentPlanSchema>;
export const escapeXml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
