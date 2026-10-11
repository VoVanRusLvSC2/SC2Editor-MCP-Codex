import * as z from "zod/v4";
const id = z.number().int().min(1).max(9999);
const raw = z.string().max(1024);
const slot = z.union([z.literal("Global"), z.number().int().min(0).max(15)]);
const definition = z.object({ id, type: z.enum(["Global", "Player"]), name: raw, access: z.enum(["Host", "Self"]).default("Host"), availability: raw.default("All"), visibility: raw.default("All") }).strict();
export const settingsOperationSchema = z.discriminatedUnion("op", [
    definition.extend({ op: z.literal("attribute.create") }),
    z.object({ op: z.literal("attribute.set"), id, field: z.enum(["Name", "Availability", "Visibility", "Access"]), value: raw }).strict(),
    z.object({ op: z.literal("attribute.value.upsert"), id, valueId: id, name: raw, description: raw.optional(), icon: raw.optional() }).strict(),
    z.object({ op: z.literal("attribute.default"), id, slot, valueId: id }).strict(),
    z.object({ op: z.literal("variant.clone"), id, sourceId: id, modeName: raw.optional(), modeDesc: raw.optional() }).strict(),
    z.object({ op: z.literal("variant.set"), id, field: z.enum(["ModeName", "ModeDesc", "CategoryId", "ModeId", "MaxTeamSize"]), value: z.union([raw, z.number().int().min(0).max(0xffffffff)]) }).strict(),
    z.object({ op: z.literal("variant.default"), id, namespace: z.number().int().min(0).max(0xffffffff), attributeId: z.number().int().min(0).max(0xffffffff), slot, valueId: z.number().int().min(0).max(0xffffffff), locked: z.boolean().optional() }).strict(),
    z.object({ op: z.literal("variant.hidden"), id, namespace: z.number().int().min(0).max(0xffffffff), attributeId: z.number().int().min(0).max(0xffffffff), hidden: z.boolean() }).strict(),
    z.object({ op: z.literal("player.set"), playerId: z.number().int().min(0).max(16), patch: z.object({ control: z.enum(["None", "User", "Computer", "Neutral", "Hostile"]).optional(), aiName: z.string().max(256).optional(), color: z.number().int().min(0).max(16).optional(), startLocation: z.number().int().min(0).max(0xffffffff).optional(), decal: z.string().max(40).optional() }).strict().refine(v => Object.keys(v).length > 0, "Empty player patch") }).strict(),
    z.object({ op: z.literal("options.set"), patch: z.object({ disableReplay: z.boolean().optional(), waitForKey: z.boolean().optional(), disableTriggerPreload: z.boolean().optional(), horizontalFov: z.boolean().optional(), hideErrorsTest: z.boolean().optional(), disableObservers: z.boolean().optional(), staggerEvents: z.boolean().optional(), showErrorsOnline: z.boolean().optional(), showCountdown: z.boolean().optional(), allUnitsUseBaseHeight: z.boolean().optional(), disableViewEveryone: z.boolean().optional(), disableTakeCommand: z.boolean().optional(), disableRecoverGame: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 0, "Empty options patch") }).strict(),
]);
export const settingsPlanSchema = z.object({ directory: z.string().default(""), operations: z.array(settingsOperationSchema).min(1).max(100) }).strict();
export type SettingsOperation = z.infer<typeof settingsOperationSchema>;
