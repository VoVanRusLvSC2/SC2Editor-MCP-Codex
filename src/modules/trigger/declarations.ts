import { scanXml } from "../../core/xmlScanner.js";
import { serializeAstElement } from "./ast/codec.js";
import { declareVariables } from "./variables.js";
import { appendGui, guiContainer, localRef } from "./xmlFragments.js";
export { typeElementFragment } from "./xmlFragments.js";
import { definitionsFor } from "./typeSystem.js";
import type { GuiRequest, Registry, GuiText } from "./authoring.js";
export function declareGuiTypes(
  xml: string,
  request: GuiRequest,
  library: string,
  nextId: () => string,
  r: Registry,
  onText: (text: GuiText) => void,
) {
  const names: GuiText[] = [],
    presets: Array<{ id: string; name: string; values: Array<{ id: string; name: string }> }> = [],
    structures: Array<{ id: string; name: string }> = [];
  const rootItem = (type: string, id: string) => {
    const p = scanXml(xml),
      parent = guiContainer(xml, library),
      root = p.nodes.find((n) => n.tag === "Root" && n.parentId === parent.id),
      ref = `<Item Type="${type}"${localRef(library)} Id="${id}"/>`;
    xml = root ? appendGui(xml, root, ref) : appendGui(xml, parent, "<Root>" + ref + "</Root>");
  };
  const name = (type: string, id: string, value: string, translations?: Record<string, string>) =>
    names.push({
      key: type + "/Name/" + (library ? "lib_" + library + "_" : "") + id,
      value,
      translations,
    });
  for (const preset of request.presets ?? []) {
    if (
      definitionsFor(xml, library, r).presets.some(
        (p) => p.library === library && p.name === preset.name,
      )
    )
      throw new Error("GUI_PRESET_NAME_EXISTS");
    if (new Set(preset.values.map((v) => v.name)).size !== preset.values.length)
      throw new Error("GUI_PRESET_VALUE_NAME_EXISTS");
    if (preset.values.filter((v) => v.default).length > 1)
      throw new Error("GUI_PRESET_MULTIPLE_DEFAULTS");
    if ((preset.integer || preset.asBits) && preset.baseType !== "int")
      throw new Error("GUI_PRESET_MODE_BASE_TYPE");
    const id = nextId(),
      values = preset.values.map((v, index) => {
        const memberId = nextId();
        if (preset.integer && v.value !== undefined)
          throw new Error("GUI_INTEGER_PRESET_EXPLICIT_VALUE");
        const scalar = preset.integer ? undefined : v.value;
        if (!preset.integer && scalar === undefined) throw new Error("GUI_PRESET_VALUE_REQUIRED");
        if (
          (preset.baseType === "int" &&
            !preset.integer &&
            (!Number.isInteger(scalar) ||
              Number(scalar) < -2147483648 ||
              Number(scalar) > 2147483647)) ||
          (preset.baseType === "bool" && typeof scalar !== "boolean") ||
          (preset.baseType === "fixed" &&
            (!Number.isFinite(Number(scalar)) ||
              Number(scalar) < -524288 ||
              Number(scalar) >= 524288)) ||
          (preset.baseType === "string" && typeof scalar !== "string")
        )
          throw new Error("GUI_PRESET_VALUE_TYPE");
        if (
          preset.asBits &&
          (Number(scalar) < 0 ||
            Number(scalar) > 2147483647 ||
            (Number(scalar) !== 0 && (Number(scalar) & (Number(scalar) - 1)) !== 0))
        )
          throw new Error("GUI_PRESET_BIT_VALUE");
        name("PresetValue", memberId, v.name, v.translations);
        return {
          id: memberId,
          type: "PresetValue" as const,
          library,
          identifier: v.name,
          value:
            scalar === undefined
              ? undefined
              : preset.baseType === "string"
                ? JSON.stringify(scalar)
                : String(scalar),
          definesDefault: v.default,
          index,
        };
      });
    const fragment =
      serializeAstElement(
        {
          id,
          type: "Preset",
          library,
          identifier: preset.name,
          baseType: preset.baseType,
          integer: preset.integer,
          asBits: preset.asBits,
          generateConstants: preset.generateConstants ?? true,
          values: values.map((v) => ({ id: v.id, type: "PresetValue", library })),
          unknownXml: preset.integer ? undefined : [{ tag: "PresetCustom" }],
        },
        library,
      ) + values.map((v) => serializeAstElement(v, library)).join("");
    xml = appendGui(xml, guiContainer(xml, library), fragment);
    rootItem("Preset", id);
    name("Preset", id, preset.name, preset.translations);
    presets.push({
      id,
      name: preset.name,
      values: values.map((v) => ({ id: v.id, name: v.identifier })),
    });
  }
  // Headers first: field types can refer to later structures.
  for (const structure of request.structures ?? []) {
    if (
      definitionsFor(xml, library, r).structures.some(
        (s) => s.library === library && s.name === structure.name,
      )
    )
      throw new Error("GUI_STRUCTURE_NAME_EXISTS");
    const id = nextId();
    xml = appendGui(
      xml,
      guiContainer(xml, library),
      serializeAstElement(
        { id, type: "Structure", library, identifier: structure.name, variables: [] },
        library,
      ),
    );
    rootItem("Structure", id);
    name("Structure", id, structure.name, structure.translations);
    structures.push({ id, name: structure.name });
  }
  for (const [index, structure] of (request.structures ?? []).entries()) {
    const result = declareVariables(
      xml,
      structure.fields.map((v) => ({ ...v, scope: "local" })),
      library,
      structures[index].id,
      nextId,
      r,
      onText,
    );
    xml = result.xml;
    names.push(...result.names);
  }
  const d = definitionsFor(xml, library, r),
    byKey = new Map(d.structures.map((s) => [(s.library ?? "") + ":" + s.id, s])),
    active = new Set<string>(),
    done = new Set<string>();
  const visit = (key: string) => {
    if (active.has(key)) throw new Error("GUI_STRUCTURE_RECURSION");
    if (done.has(key)) return;
    active.add(key);
    const s = byKey.get(key);
    for (const ref of s?.variables ?? []) {
      const v = d.variables.find(
        (v) => v.id === ref.id && v.library === (ref.library ?? s?.library),
      );
      const te = v?.variableType?.typeElement;
      if (v?.variableType?.type === "struct" && te)
        visit((te.library ?? v.library ?? "") + ":" + te.id);
    }
    active.delete(key);
    done.add(key);
  };
  for (const s of structures) visit(library + ":" + s.id);
  return { xml, names, presets, structures };
}
