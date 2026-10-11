import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import type { SettingsOperation } from "./schemas.js";
export const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("\r", "&#13;").replaceAll("\n", "&#10;").replaceAll("\t", "&#9;");
export class SettingsXml {
    readonly parsed: ReturnType<typeof scanXml>;
    readonly root: XmlNode;
    constructor(readonly source: string, rootTag: string) {
        if (Buffer.byteLength(source) > 8 * 1024 * 1024)
            throw new Error("SETTINGS_XML_SIZE_LIMIT");
        this.parsed = scanXml(source);
        if (this.parsed.diagnostics.some(d => d.severity === "error") || this.parsed.rootIds.length !== 1)
            throw new Error("INVALID_SETTINGS_XML");
        this.root = this.parsed.nodes[this.parsed.rootIds[0]];
        if (this.root.tag !== rootTag)
            throw new Error("INVALID_SETTINGS_ROOT");
    }
    children(parent: XmlNode, tag?: string) { return parent.childIds.map(id => this.parsed.nodes[id]).filter(n => !tag || n.tag === tag); }
    one(parent: XmlNode, tag: string, required = false) { const found = this.children(parent, tag); if (found.length > 1)
        throw new Error(`AMBIGUOUS_SETTINGS_FIELD: ${tag}`); if (required && !found.length)
        throw new Error(`MISSING_SETTINGS_FIELD: ${tag}`); return found[0]; }
    value(parent: XmlNode, tag: string) { return this.one(parent, tag)?.attrs.Value; }
    raw(node: XmlNode) { return this.source.slice(node.start, node.end); }
    replace(start: number, end: number, value: string) { return this.source.slice(0, start) + value + this.source.slice(end); }
    attr(node: XmlNode, name: string, value: string) { const span = node.attrSpans.find(s => s.name === name); if (!span)
        throw new Error("SETTINGS_ATTRIBUTE_NOT_FOUND"); if (node.attrs[name] === value)
        return this.source; return this.replace(span.valueStart, span.valueEnd, escape(value)); }
    insert(parent: XmlNode, xml: string) {
        const eol = this.source.includes("\r\n") ? "\r\n" : "\n";
        const prefix = this.source.slice(this.source.lastIndexOf("\n", parent.endTagStart - 1) + 1, parent.endTagStart);
        const indent = /^[ \t]*$/.test(prefix) ? prefix : "";
        if (parent.selfClosing) {
            const openingIndent = this.source.slice(this.source.lastIndexOf("\n", parent.start - 1) + 1, parent.start);
            const base = /^[ \t]*$/.test(openingIndent) ? openingIndent : "";
            return this.replace(parent.startTagEnd - 2, parent.startTagEnd, ">" + eol + base + "    " + xml + eol + base + `</${parent.tag}>`);
        }
        return this.replace(parent.endTagStart, parent.endTagStart, "    " + xml + eol + indent);
    }
    setField(parent: XmlNode, tag: string, value: string) { const node = this.one(parent, tag); return node ? this.attr(node, "Value", value) : this.insert(parent, `<${tag} Value="${escape(value)}"/>`); }
}
export class AttributesDocument extends SettingsXml {
    readonly definitions: XmlNode[];
    readonly variants: XmlNode[];
    constructor(source: string) {
        super(source, "Attributes");
        this.definitions = this.children(this.root, "Attribute");
        this.variants = this.children(this.root, "Variant");
        for (const rows of [this.definitions, this.variants]) {
            const ids = rows.map(n => this.value(n, "Id"));
            if (ids.some(id => !id || !/^[1-9]\d{0,3}$/.test(id)) || new Set(ids).size !== ids.length)
                throw new Error("INVALID_OR_DUPLICATE_SETTINGS_ID");
        }
    }
    definition(id: number) { const node = this.definitions.find(n => this.value(n, "Id") === String(id)); if (!node)
        throw new Error("ATTRIBUTE_NOT_FOUND"); return node; }
    variant(id: number) { const node = this.variants.find(n => this.value(n, "Id") === String(id)); if (!node)
        throw new Error("VARIANT_NOT_FOUND"); return node; }
    defaults(parent: XmlNode) { return this.children(parent, "Default").map(n => ({ slot: this.one(n, "Slot", true)!.attrs.Id, valueId: this.one(n, "Value", true)!.attrs.Id, locked: !!this.one(n, "Locked") })); }
    attributeDetails(id: number) { const n = this.definition(id); return { id, type: this.value(n, "Type"), name: this.value(n, "Name"), availability: this.value(n, "Availability"), visibility: this.value(n, "Visibility"), access: this.value(n, "Access"), publicLocked: !!this.one(n, "PublicLocked"), values: this.children(n, "Value").map(v => ({ id: this.value(v, "Id"), name: this.value(v, "Name"), description: this.value(v, "Description"), icon: this.value(v, "Icon") })), defaults: this.defaults(n), unknownChildren: this.children(n).filter(c => !["Id", "Type", "Name", "Availability", "Visibility", "Access", "PublicLocked", "Value", "Default"].includes(c.tag)).map(c => c.tag) }; }
    variantDetails(id: number) { const n = this.variant(id); return { id, fields: Object.fromEntries(["CategoryId", "ModeId", "ModeName", "ModeDesc", "MaxTeamSize"].map(key => [key, this.value(n, key)])), hidden: this.children(n, "AttributeHidden").map(c => c.attrs), attributes: this.children(n, "Attribute").map(c => ({ namespace: c.attrs.Namespace, id: c.attrs.Id, defaults: this.defaults(c) })), unknownChildren: this.children(n).filter(c => !["Id", "CategoryId", "ModeId", "ModeName", "ModeDesc", "MaxTeamSize", "AttributeHidden", "Attribute"].includes(c.tag)).map(c => c.tag) }; }
    inspect() { return { attributes: this.definitions.map(n => ({ id: Number(this.value(n, "Id")), type: this.value(n, "Type"), name: this.value(n, "Name"), values: this.children(n, "Value").length })), variants: this.variants.map(n => ({ id: Number(this.value(n, "Id")), modeName: this.value(n, "ModeName"), maxTeamSize: this.value(n, "MaxTeamSize") })), defaultVariants: this.value(this.root, "DefaultVariants"), unknownRootChildren: this.children(this.root).filter(c => !["Attribute", "Variant", "DefaultVariants"].includes(c.tag)).map(c => c.tag) }; }
    private setDefault(parent: XmlNode, slot: string, value: string, locked?: boolean) {
        const found = this.children(parent, "Default").filter(n => this.one(n, "Slot", true)!.attrs.Id === slot);
        if (found.length > 1)
            throw new Error("DUPLICATE_DEFAULT_SLOT");
        const node = found[0];
        if (!node)
            return this.insert(parent, `<Default><Slot Id="${slot}"/><Value Id="${value}"/>${locked ? "<Locked/>" : ""}</Default>`);
        let text = this.attr(this.one(node, "Value", true)!, "Id", value);
        if (locked !== undefined) {
            const doc = new SettingsXml(text, "Attributes");
            const updated = doc.parsed.nodes[node.id], lock = doc.one(updated, "Locked");
            if (locked && !lock)
                text = doc.insert(updated, "<Locked/>");
            else if (!locked && lock)
                text = doc.replace(lock.start, lock.end, "");
        }
        return text;
    }
    patch(operation: SettingsOperation): string {
        let text = this.source;
        if (operation.op === "attribute.create") {
            if (this.definitions.some(n => this.value(n, "Id") === String(operation.id)))
                throw new Error("ATTRIBUTE_ID_EXISTS");
            const fields = { Id: operation.id, Type: operation.type, Name: operation.name, Availability: operation.availability, Visibility: operation.visibility, Access: operation.access };
            const xml = `<Attribute>${Object.entries(fields).map(([k, v]) => `<${k} Value="${escape(String(v))}"/>`).join("")}</Attribute>`;
            const next = this.children(this.root).find(n => n.tag === "DefaultVariants" || n.tag === "Variant");
            text = next ? this.replace(next.start, next.start, xml + (this.source.includes("\r\n") ? "\r\n" : "\n") + "    ") : this.insert(this.root, xml);
        }
        else if (operation.op === "attribute.set") {
            if (operation.field === "Access" && !["Host", "Self"].includes(operation.value))
                throw new Error("INVALID_ATTRIBUTE_ACCESS");
            text = this.setField(this.definition(operation.id), operation.field, operation.value);
        }
        else if (operation.op === "attribute.value.upsert") {
            const parent = this.definition(operation.id), matches = this.children(parent, "Value").filter(n => this.value(n, "Id") === String(operation.valueId));
            if (matches.length > 1)
                throw new Error("DUPLICATE_ATTRIBUTE_VALUE");
            const fields = { Name: operation.name, Description: operation.description, Icon: operation.icon };
            if (!matches.length)
                text = this.insert(parent, `<Value><Id Value="${operation.valueId}"/>${Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `<${k} Value="${escape(v!)}"/>`).join("")}</Value>`);
            else {
                for (const [key, val] of Object.entries(fields)) {
                    if (val === undefined)
                        continue;
                    const doc = new AttributesDocument(text), p = doc.definition(operation.id), v = doc.children(p, "Value").find(n => doc.value(n, "Id") === String(operation.valueId))!;
                    text = doc.setField(v, key, val);
                }
            }
        }
        else if (operation.op === "attribute.default") {
            const n = this.definition(operation.id), type = this.value(n, "Type");
            if ((type === "Global") !== (operation.slot === "Global") || !["Global", "Player"].includes(type!))
                throw new Error("ATTRIBUTE_SCOPE_MISMATCH");
            if (!this.children(n, "Value").some(v => this.value(v, "Id") === String(operation.valueId)))
                throw new Error("ATTRIBUTE_VALUE_NOT_FOUND");
            text = this.setDefault(n, String(operation.slot), String(operation.valueId));
        }
        else if (operation.op === "variant.clone") {
            if (this.variants.some(n => this.value(n, "Id") === String(operation.id)))
                throw new Error("VARIANT_ID_EXISTS");
            const clone = new SettingsXml(this.raw(this.variant(operation.sourceId)), "Variant");
            let raw = clone.setField(clone.root, "Id", String(operation.id));
            for (const [key, value] of [["ModeName", operation.modeName], ["ModeDesc", operation.modeDesc]] as const)
                if (value !== undefined) {
                    const d = new SettingsXml(raw, "Variant");
                    raw = d.setField(d.root, key, value);
                }
            text = this.insert(this.root, raw);
        }
        else if (operation.op === "variant.set") {
            if (["CategoryId", "ModeId", "MaxTeamSize"].includes(operation.field)) {
                const v = Number(operation.value);
                if (!Number.isInteger(v) || v < 0 || v > 0xffffffff || (operation.field === "MaxTeamSize" && (v < 1 || v > 16)))
                    throw new Error("INVALID_VARIANT_NUMBER");
            }
            text = this.setField(this.variant(operation.id), operation.field, String(operation.value));
        }
        else if (operation.op === "variant.default" || operation.op === "variant.hidden") {
            const n = this.variant(operation.id), matches = this.children(n, "Attribute").filter(c => c.attrs.Namespace === String(operation.namespace) && c.attrs.Id === String(operation.attributeId));
            if (matches.length > 1)
                throw new Error("AMBIGUOUS_VARIANT_ATTRIBUTE");
            // An existing binding pins the namespace and attribute identity. No invented standard enums.
            if (!matches.length)
                throw new Error("VARIANT_ATTRIBUTE_BINDING_NOT_FOUND");
            if (operation.op === "variant.default") {
                const defaults = this.defaults(matches[0]);
                if (defaults.length && defaults.every(d => d.slot === "Global") !== (operation.slot === "Global"))
                    throw new Error("VARIANT_ATTRIBUTE_SCOPE_MISMATCH");
                text = this.setDefault(matches[0], String(operation.slot), String(operation.valueId), operation.locked);
            }
            else {
                const rows = this.children(n, "AttributeHidden").filter(c => c.attrs.Namespace === String(operation.namespace) && c.attrs.Id === String(operation.attributeId));
                if (rows.length > 1)
                    throw new Error("AMBIGUOUS_HIDDEN_ATTRIBUTE");
                if (operation.hidden && !rows.length)
                    text = this.insert(n, `<AttributeHidden Namespace="${operation.namespace}" Id="${operation.attributeId}"/>`);
                else if (!operation.hidden && rows[0])
                    text = this.replace(rows[0].start, rows[0].end, "");
            }
        }
        else
            throw new Error("NOT_AN_ATTRIBUTE_OPERATION");
        const next = new AttributesDocument(text);
        next.inspect();
        return text;
    }
}
