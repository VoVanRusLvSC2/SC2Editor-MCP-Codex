export function serializeM3SectionList(sections) {
    if (!sections.fileBuffer)
        throw new Error('M3SectionList has no original file buffer to serialize losslessly');
    return new Uint8Array(sections.fileBuffer.slice(0));
}
export function serializeM3Model(model) {
    return serializeM3SectionList(model.sections);
}
export function getM3SectionInventory(sections) {
    return sections.map((section, index) => {
        const repetitions = Number(section.indexEntry.repetitions ?? 0);
        const offset = Number(section.indexEntry.offset ?? 0);
        return {
            index,
            tag: section.desc.history.name,
            version: Number(section.indexEntry.version ?? 0),
            repetitions,
            offset,
            byteLength: section.rawBytes?.byteLength ?? 0,
        };
    });
}
export function m3MetadataOracle(model) {
    const render = model.toRenderModel();
    return {
        mdVersion: model.sections.mdVersion,
        sectionCount: model.sections.length,
        meshCount: render.meshes.length,
        materialCount: model.materials.length,
        boneCount: model.bones.length,
        animationCount: render.animations.length,
    };
}
export function compareM3MetadataOracle(model, oracle) {
    const actual = m3MetadataOracle(model);
    const mismatches = [];
    for (const key of Object.keys(oracle)) {
        const expected = oracle[key];
        if (expected === undefined)
            continue;
        if (actual[key] !== expected)
            mismatches.push({ field: key, expected, actual: actual[key] });
    }
    return mismatches;
}
//# sourceMappingURL=lossless.js.map