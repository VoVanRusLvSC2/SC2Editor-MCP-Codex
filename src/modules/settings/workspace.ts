import path from "node:path";
import { Workspace } from "../../core/workspace.js";
import { bytesHash, type ByteOptions } from "../../core/binaryTransactions.js";
import { decodeUtf8 } from "../../core/fileTransactions.js";
import { directoryManifest, type DirectoryEntry } from "../../archive/archiveAdapter.js";
import { AttributesDocument, SettingsXml } from "./attributes.js";
import { PlayersDocument } from "./players.js";
import { settingsPlanSchema, type SettingsOperation } from "./schemas.js";
interface Plan {
    id: string;
    directory: string;
    manifest: DirectoryEntry[];
    next: Map<string, Buffer>;
    source: Record<string, string>;
    operations: SettingsOperation[];
}
export class SettingsWorkspace {
    private readonly plans = new Map<string, Plan>();
    constructor(readonly workspace: Workspace) { }
    capabilities() { return { module: "settings", mapInfoVersion: 39, attributes: ["create definition with values in one plan", "set name/access/visibility/availability", "upsert values", "set scoped defaults"], variants: ["inspect", "clone existing native variant", "set mode/category/team-size fields", "edit defaults/locks and visibility of existing attribute bindings"], players: ["control", "aiName", "color", "registered startLocation", "decal"], options: 13, losslessPatches: true, stagedTransactions: true, editorValidation: "NOT_EXECUTED", gaps: ["No player count/slot renumbering or team/alliance matrix rebuild", "No standard-attribute enum inference or new namespace bindings", "No default-variant regeneration, arbitrary MapInfo versions or from-scratch variant defaults", "Names/descriptions are localization keys; write localized text with existing Text tools", "No Editor/engine validation for settings"] }; }
    private file(directory: string, name: string) { return this.workspace.binary.key(path.join(directory, name)); }
    private noDrafts(directory: string, except: string[] = []) { const root = this.workspace.resolveUserPath(directory), allowed = new Set(except); for (const file of [...this.workspace.draftFiles(), ...this.workspace.binary.draftFiles()]) {
        const rel = path.relative(root, this.workspace.resolveUserPath(file));
        if (!allowed.has(file) && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
            throw new Error("SETTINGS_DRAFTS_PENDING: " + file);
    } }
    async attributes(directory = "") { const raw = await this.workspace.binary.read(this.file(directory, "Attributes")); if (!raw.exists && !raw.staged)
        return undefined; return new AttributesDocument(decodeUtf8(raw.bytes, "Attributes")); }
    async players(directory = "") { const raw = await this.workspace.binary.read(this.file(directory, "MapInfo")); if (!raw.exists && !raw.staged)
        throw new Error("MAPINFO_MISSING"); return new PlayersDocument(raw.bytes); }
    async inspect(directory = "") {
        const errors: string[] = [];
        let attributes: ReturnType<AttributesDocument["inspect"]> | undefined, players: ReturnType<PlayersDocument["inspect"]> | undefined;
        try {
            attributes = (await this.attributes(directory))?.inspect();
        }
        catch (e) {
            errors.push(String(e));
        }
        try {
            players = (await this.players(directory)).inspect();
        }
        catch (e) {
            errors.push(String(e));
        }
        return { directory, valid: errors.length === 0, errors, attributes: attributes ? { attributeCount: attributes.attributes.length, variantCount: attributes.variants.length, defaultVariants: attributes.defaultVariants, unknownRootChildren: attributes.unknownRootChildren } : { present: false }, players, capabilities: this.capabilities() };
    }
    async list(directory: string, kind: "attributes" | "variants", offset = 0, limit = 50) { const doc = await this.attributes(directory), all = doc?.inspect()[kind] ?? []; return { directory, total: all.length, offset, items: all.slice(offset, offset + limit), nextOffset: offset + limit < all.length ? offset + limit : null }; }
    async get(directory: string, kind: "attribute" | "variant", id: number) { const doc = await this.attributes(directory); if (!doc)
        throw new Error("ATTRIBUTES_MISSING"); return kind === "attribute" ? doc.attributeDetails(id) : doc.variantDetails(id); }
    async plan(request: {
        directory?: string;
        operations: SettingsOperation[];
    }) {
        const { directory, operations } = settingsPlanSchema.parse(request);
        this.noDrafts(directory);
        const root = this.workspace.resolveUserPath(directory), manifest = await directoryManifest(root), mapFile = this.file(directory, "MapInfo"), attributeFile = this.file(directory, "Attributes"), componentFile = this.file(directory, "ComponentList.SC2Components");
        const initial = new Map<string, Buffer>();
        for (const file of [mapFile, attributeFile, componentFile])
            initial.set(file, (await this.workspace.binary.read(file, false)).bytes);
        let map = initial.get(mapFile)!, attributes = initial.get(attributeFile)!;
        new PlayersDocument(map);
        for (const op of operations) {
            if (op.op === "player.set" || op.op === "options.set")
                map = new PlayersDocument(map).patch(op);
            else {
                if (!attributes.length) {
                    if (op.op !== "attribute.create")
                        throw new Error("ATTRIBUTES_MISSING");
                    attributes = Buffer.from('<?xml version="1.0" encoding="utf-8"?>\r\n<Attributes>\r\n    <DefaultVariants Value="0"/>\r\n</Attributes>');
                }
                attributes = Buffer.from(new AttributesDocument(decodeUtf8(attributes, "Attributes")).patch(op));
            }
        }
        const next = new Map<string, Buffer>();
        if (!map.equals(initial.get(mapFile)!))
            next.set(mapFile, map);
        if (!attributes.equals(initial.get(attributeFile)!)) {
            const doc = new AttributesDocument(decodeUtf8(attributes, "Attributes"));
            for (const op of operations.filter((op): op is Extract<SettingsOperation, {
                op: "attribute.create";
            }> => op.op === "attribute.create"))
                if (!doc.attributeDetails(op.id).values.length)
                    throw new Error("NEW_ATTRIBUTE_REQUIRES_VALUES_IN_PLAN");
            next.set(attributeFile, attributes);
            const original = decodeUtf8(initial.get(componentFile)!, "ComponentList.SC2Components"), component = new SettingsXml(original, "Components"), declared = component.children(component.root).filter(n => n.attrs.Type === "attr");
            if (declared.length > 1)
                throw new Error("AMBIGUOUS_ATTRIBUTE_COMPONENT");
            if (declared.length && original.slice(declared[0].startTagEnd, declared[0].endTagStart).trim() !== "Attributes")
                throw new Error("CUSTOM_ATTRIBUTE_COMPONENT_PRESERVE_ONLY");
            if (!declared.length)
                next.set(componentFile, Buffer.from(component.insert(component.root, '<DataComponent Type="attr">Attributes</DataComponent>')));
        }
        const source = Object.fromEntries([...next.keys()].map(file => [file, bytesHash(initial.get(file)!)]));
        if (JSON.stringify(await directoryManifest(root)) !== JSON.stringify(manifest))
            throw new Error("STALE_SETTINGS_PLAN");
        const id = "settings_" + bytesHash(Buffer.from(JSON.stringify({ directory, operations, manifest, after: [...next].map(([file, b]) => [file, bytesHash(b)]) }))).slice(0, 24);
        this.plans.set(id, { id, directory, manifest, next, source, operations: structuredClone(operations) });
        while (this.plans.size > 16)
            this.plans.delete(this.plans.keys().next().value!);
        return { id, directory, valid: true, operations, files: [...next].map(([file, b]) => ({ file, beforeSha256: source[file], afterSha256: bytesHash(b), bytes: b.length })), after: { players: new PlayersDocument(map).inspect(), attributes: attributes.length ? new AttributesDocument(decodeUtf8(attributes, "Attributes")).inspect() : undefined }, editorValidation: "NOT_EXECUTED" };
    }
    async apply(planId: string, options: ByteOptions = {}) {
        const plan = this.plans.get(planId);
        if (!plan)
            throw new Error("SETTINGS_PLAN_NOT_FOUND");
        const files = [...plan.next.keys()];
        const verify = async () => { this.noDrafts(plan.directory, files); if (JSON.stringify(await directoryManifest(this.workspace.resolveUserPath(plan.directory))) !== JSON.stringify(plan.manifest))
            throw new Error("STALE_SETTINGS_PLAN: map content or entry list changed"); await options.verify?.(); };
        if (!files.length) {
            await verify();
            return { accepted: true, dryRun: options.dryRun ?? true, staged: false, saved: false, transactionId: undefined, files: [], unchanged: true };
        }
        return this.workspace.binary.apply(files, current => { for (const [file, b] of current)
            if (bytesHash(b) !== plan.source[file])
                throw new Error("STALE_SETTINGS_DRAFT: " + file); return new Map(plan.next); }, { ...options, expectedSha256: { ...options.expectedSha256, ...plan.source }, verify });
    }
    save(transactionId: string, options: Omit<ByteOptions, "stage"> = {}) { return this.workspace.binary.save(transactionId, options); }
    discard(transactionId: string, dryRun = true) { return this.workspace.binary.discard(transactionId, dryRun); }
}
