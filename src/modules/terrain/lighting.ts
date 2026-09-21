import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll("'", "&apos;");
export interface LightingPatch {
    timePerDay?: string;
    timePerLoop?: string;
    timeStart?: string;
    timeEvents?: Array<{
        index: "Dawn" | "Dusk";
        time: string;
        name?: string;
    }>;
    id: string;
    parent?: string;
    stateIndex?: number;
    ambientColor?: [
        number,
        number,
        number
    ];
    exposure?: number;
    whitePoint?: number;
    directional?: Array<{
        index: "Key" | "Fill" | "Back";
        color?: [
            number,
            number,
            number
        ];
        direction?: [
            number,
            number,
            number
        ];
        intensity?: number;
    }>;
}
/** Edit only verified native catalog fields; retain other states and opaque fields. */
export class LightingCatalog {
    readonly parsed;
    readonly root: XmlNode;
    constructor(readonly source: string, readonly tag: "CLight" | "CTerrain") {
        if (/<!DOCTYPE|<!ENTITY/i.test(source))
            throw new Error("LIGHTING_DTD_UNSUPPORTED");
        this.parsed = scanXml(source);
        this.root = this.parsed.nodes[this.parsed.rootIds[0]];
        if (this.parsed.rootIds.length !== 1 || this.root?.tag !== "Catalog" || this.parsed.diagnostics.some(d => d.severity === "error"))
            throw new Error("INVALID_LIGHTING_CATALOG");
        const ids = this.objects().map(n => n.attrs.id).filter(Boolean);
        if (new Set(ids).size !== ids.length)
            throw new Error("DUPLICATE_LIGHTING_ID");
    }
    objects() { return this.parsed.nodes.filter(n => n.parentId === this.root.id && n.tag === this.tag); }
    private values(node: XmlNode) {
        const fields = this.parsed.nodes.filter(c => c.parentId === node.id && (node.tag !== "CTerrain" || c.tag === "Lighting") && c.tag !== "Param" && c.tag !== "DirectionalLight" && c.attrs.index === undefined);
        const result: Record<string, string> = { ...node.attrs };
        for (const field of fields) {
            if (result[field.tag] !== undefined)
                throw new Error(`AMBIGUOUS_LIGHTING_FIELD: ${field.tag}`);
            if (field.attrs.value !== undefined)
                result[field.tag] = field.attrs.value;
        }
        return result;
    }
    list() {
        return this.objects().filter(n => n.attrs.id).map(n => ({ id: n.attrs.id, parent: n.attrs.parent,
            lighting: this.values(n).Lighting,
            cycle: { timePerDay: this.values(n).TimePerDay, timePerLoop: this.values(n).TimePerLoop, timeStart: this.values(n).TimeStart, events: this.parsed.nodes.filter(e => e.parentId === n.id && e.tag === "TimeEventArray").map(e => this.values(e)) },
            states: this.parsed.nodes.filter(c => c.parentId === n.id && c.tag === "ToDInfoArray").map((c, i) => ({ ...this.values(c), AmbientColor: this.values(c).AmbientColor, index: c.attrs.index ?? String(i),
                parameters: this.parsed.nodes.filter(p => p.parentId === c.id && p.tag === "Param").map(p => ({ ...p.attrs })),
                directional: this.parsed.nodes.filter(p => p.parentId === c.id && p.tag === "DirectionalLight").map(p => this.values(p))
            })) }));
    }
    private insert(n: XmlNode, text: string) { return n.selfClosing ? this.source.slice(0, n.startTagEnd - 2) + `>${text}</${n.tag}>` + this.source.slice(n.end) : this.source.slice(0, n.endTagStart) + text + this.source.slice(n.endTagStart); }
    private attr(n: XmlNode, key: string, value: string) { const span = n.attrSpans.find(s => s.name === key); return span ? this.source.slice(0, span.valueStart) + esc(value) + this.source.slice(span.valueEnd) : this.source.slice(0, n.startTagEnd - (n.selfClosing ? 2 : 1)) + ` ${key}="${esc(value)}"` + this.source.slice(n.startTagEnd - (n.selfClosing ? 2 : 1)); }
    private field(n: XmlNode, key: string, value: string) { const children = this.parsed.nodes.filter(c => c.parentId === n.id && c.tag === key); if (children.length > 1 || (children.length && n.attrs[key] !== undefined))
        throw new Error("AMBIGUOUS_LIGHTING_FIELD"); return children.length ? this.attr(children[0], "value", value) : this.attr(n, key, value); }
    private ensure(id: string, parent?: string) { if (!id || [...id].some(c => c.charCodeAt(0) < 32) || parent === id)
        throw new Error("INVALID_LIGHTING_ID"); const n = this.objects().find(n => n.attrs.id === id); if (n && parent !== undefined && n.attrs.parent !== parent)
        throw new Error("LIGHTING_REPARENT_UNSUPPORTED"); return n ? this.source : this.insert(this.root, `<${this.tag} id="${esc(id)}"${parent ? ` parent="${esc(parent)}"` : ""}/>`); }
    bind(id: string, light: string) { const c = new LightingCatalog(this.ensure(id), "CTerrain"), n = c.objects().find(n => n.attrs.id === id)!; const fields = c.parsed.nodes.filter(f => f.parentId === n.id && f.tag === "Lighting"); if (fields.length > 1 || (fields.length && n.attrs.Lighting !== undefined))
        throw new Error("AMBIGUOUS_TERRAIN_LIGHTING"); const result = fields.length ? c.attr(fields[0], "value", light) : n.attrs.Lighting !== undefined ? c.attr(n, "Lighting", light) : c.insert(n, `<Lighting value="${esc(light)}"/>`); return [...result].some(ch => ch.charCodeAt(0) > 127) ? result.replace(/encoding=("|')us-ascii\1/i, 'encoding="utf-8"') : result; }
    patch(p: LightingPatch) {
        let result = this.ensure(p.id, p.parent);
        for (const [key, value] of Object.entries({ TimePerDay: p.timePerDay, TimePerLoop: p.timePerLoop, TimeStart: p.timeStart })) {
            if (value === undefined)
                continue;
            const c = new LightingCatalog(result, "CLight"), n = c.objects().find(n => n.attrs.id === p.id)!;
            result = n.attrs[key]!==undefined || c.parsed.nodes.some(child=>child.parentId===n.id&&child.tag===key) ? c.field(n,key,value) : c.insert(n,`<${key} value="${esc(value)}"/>`);
        }
        for (const event of p.timeEvents ?? []) {
            let c = new LightingCatalog(result, "CLight"), obj = c.objects().find(n => n.attrs.id === p.id)!;
            const events = c.parsed.nodes.filter(n => n.parentId === obj.id && n.tag === "TimeEventArray" && n.attrs.index === event.index);
            if (events.length > 1)
                throw new Error("AMBIGUOUS_LIGHTING_TIME_EVENT");
            if (!events.length)
                result = c.insert(obj, `<TimeEventArray index="${event.index}"/>`);
            for (const [key, value] of Object.entries({ Time: event.time, Name: event.name })) {
                if (value === undefined)
                    continue;
                c = new LightingCatalog(result, "CLight");
                obj = c.objects().find(n => n.attrs.id === p.id)!;
                const node = c.parsed.nodes.find(n => n.parentId === obj.id && n.tag === "TimeEventArray" && n.attrs.index === event.index)!;
                result = c.field(node, key, value);
            }
        }
        for (const [key, value] of Object.entries({ AmbientColor: p.ambientColor?.join(","), HDRExposure: p.exposure?.toString(), HDRWhitePoint: p.whitePoint?.toString() })) {
            if (value === undefined)
                continue;
            let c = new LightingCatalog(result, "CLight"), n = c.objects().find(n => n.attrs.id === p.id)!;
            let states = c.parsed.nodes.filter(s => s.parentId === n.id && s.tag === "ToDInfoArray" && Number(s.attrs.index ?? 0) === (p.stateIndex ?? 0));
            if (states.length > 1)
                throw new Error("AMBIGUOUS_LIGHTING_STATE");
            if (!states.length) {
                result = c.insert(n, `<ToDInfoArray index="${p.stateIndex ?? 0}"/>`);
                c = new LightingCatalog(result, "CLight");
                n = c.objects().find(n => n.attrs.id === p.id)!;
                states = c.parsed.nodes.filter(s => s.parentId === n.id && s.tag === "ToDInfoArray" && Number(s.attrs.index ?? 0) === (p.stateIndex ?? 0));
            }
            const state = states[0];
            if (key === "AmbientColor")
                result = c.field(state, key, value);
            else {
                const params = c.parsed.nodes.filter(f => f.parentId === state.id && f.tag === "Param" && f.attrs.index === key);
                if (params.length > 1)
                    throw new Error("AMBIGUOUS_LIGHTING_PARAMETER");
                result = params.length ? c.attr(params[0], "value", value) : c.insert(state, `<Param index="${key}" value="${value}"/>`);
            }
        }
        for (const light of p.directional ?? []) {
            let c = new LightingCatalog(result, "CLight"), obj = c.objects().find(n => n.attrs.id === p.id)!;
            let states = c.parsed.nodes.filter(n => n.parentId === obj.id && n.tag === "ToDInfoArray" && Number(n.attrs.index ?? 0) === (p.stateIndex ?? 0));
            if (states.length > 1)
                throw new Error("AMBIGUOUS_LIGHTING_STATE");
            if (!states.length) {
                result = c.insert(obj, `<ToDInfoArray index="${p.stateIndex ?? 0}"/>`);
                c = new LightingCatalog(result, "CLight");
                obj = c.objects().find(n => n.attrs.id === p.id)!;
                states = c.parsed.nodes.filter(n => n.parentId === obj.id && n.tag === "ToDInfoArray" && Number(n.attrs.index ?? 0) === (p.stateIndex ?? 0));
            }
            const matches = c.parsed.nodes.filter(n => n.parentId === states[0].id && n.tag === "DirectionalLight" && n.attrs.index === light.index);
            if (matches.length > 1)
                throw new Error("AMBIGUOUS_DIRECTIONAL_LIGHT");
            if (!matches.length)
                result = c.insert(states[0], `<DirectionalLight index="${light.index}"/>`);
            for (const [key, value] of Object.entries({ Color: light.color?.join(","), Direction: light.direction?.join(","), ColorMultiplier: light.intensity?.toString() })) {
                if (value === undefined)
                    continue;
                c = new LightingCatalog(result, "CLight");
                obj = c.objects().find(n => n.attrs.id === p.id)!;
                const state = c.parsed.nodes.find(n => n.parentId === obj.id && n.tag === "ToDInfoArray" && Number(n.attrs.index ?? 0) === (p.stateIndex ?? 0))!;
                const node = c.parsed.nodes.find(n => n.parentId === state.id && n.tag === "DirectionalLight" && n.attrs.index === light.index)!;
                result = c.field(node, key, value);
            }
        }
        if ([...result].some(c => c.charCodeAt(0) > 127))
            result = result.replace(/encoding=("|')us-ascii\1/i, 'encoding="utf-8"');
        new LightingCatalog(result, "CLight");
        return result;
    }
}
