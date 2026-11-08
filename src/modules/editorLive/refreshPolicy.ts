/** Component authoring only; no nested sessions, archive handoffs or native test workers. */
export function refreshAuthoringAllowed(name: string, args?: Record<string, unknown>) {
  if (
    /^(ui|text|data|browse|placement|terrain|script|trigger|settings|ai|assets|lighting|casc|cutscene)\./.test(
      name,
    )
  )
    return true;
  if (["modkit.save", "modkit.discard", "modkit.author_help"].includes(name)) return true;
  if (
    !name.startsWith("map.") ||
    /^(map\.(export|import|clone|create|blueprint\.register))$/.test(name)
  )
    return false;
  return name !== "map.minimap.rebuild" || args?.backend === "overview";
}
