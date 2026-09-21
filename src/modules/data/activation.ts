import path from "node:path";
import { scanXml } from "../../core/xmlScanner.js";
export interface CatalogActivation {
    mode: "EXPLICIT_INCLUDES" | "UNVERIFIED_LOOSE";
    files: Set<string>;
    warnings: string[];
}
/** Native Includes graph. Unknown implicit engine defaults remain explicitly unverified. */
export async function catalogActivation(read: (file: string) => Promise<string | undefined>): Promise<CatalogActivation> {
    const files = new Set<string>(), visited = new Set<string>(), warnings: string[] = [];
    const first = await read("Base.SC2Data/GameData.xml");
    if (first === undefined)
        return { mode: "UNVERIFIED_LOOSE", files, warnings: ["GameData.xml absent: loose discovery does not establish engine-active catalogs"] };
    const visit = async (file: string, source: string): Promise<void> => {
        const key = file.toLowerCase();
        if (visited.has(key))
            throw new Error(`CATALOG_INCLUDE_CYCLE: ${file}`);
        visited.add(key);
        const parsed = scanXml(source);
        if (parsed.diagnostics.some(d => d.severity === "error") || parsed.rootIds.length !== 1)
            throw new Error(`INVALID_CATALOG_INCLUDE_XML: ${file}`);
        const root = parsed.nodes[parsed.rootIds[0]];
        if (root.tag === "Catalog") {
            files.add(key);
            visited.delete(key);
            return;
        }
        if (root.tag !== "Includes")
            throw new Error(`INVALID_CATALOG_INCLUDE_ROOT: ${file}`);
        for (const node of parsed.nodes.filter(n => n.parentId === root.id && n.tag === "Catalog")) {
            const raw = node.attrs.path?.replaceAll("\\", "/");
            if (!raw || path.posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw))
                throw new Error(`INVALID_CATALOG_INCLUDE_PATH: ${raw}`);
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), raw));
            if (!target.toLowerCase().startsWith("base.sc2data/"))
                throw new Error(`CATALOG_INCLUDE_PATH_ESCAPE: ${raw}`);
            const text = await read(target);
            if (text === undefined)
                warnings.push(`Missing active catalog: ${target}`);
            else
                await visit(target, text);
        }
        visited.delete(key);
    };
    await visit("Base.SC2Data/GameData.xml", first);
    return { mode: "EXPLICIT_INCLUDES", files, warnings };
}
