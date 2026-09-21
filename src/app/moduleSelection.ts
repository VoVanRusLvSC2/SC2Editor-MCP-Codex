export const publicModules = ["ui", "cutscene", "text", "data", "browse", "placement", "ai", "terrain", "map", "script"] as const;
export type PublicModule = typeof publicModules[number];

const profiles: Record<string, PublicModule[]> = {
  all: [...publicModules],
  ui: ["ui", "text"],
  cutscene: ["ui", "cutscene", "browse", "data"],
  data: ["ui", "data", "browse"],
  terrain: ["ui", "terrain", "placement", "browse", "data", "map"],
  script: ["ui", "script"],
  authoring: ["ui", "cutscene", "text", "data", "browse", "placement", "terrain", "map", "script"],
};

export interface ModuleSelection {
  profile: string;
  modules: ReadonlySet<PublicModule>;
  unknown: string[];
  source: "default" | "SC2_MCP_PROFILE" | "SC2_MCP_MODULES";
}

export function resolveModuleSelection(env: NodeJS.ProcessEnv = process.env): ModuleSelection {
  const explicit = env.SC2_MCP_MODULES?.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (explicit?.length) {
    const known = explicit.filter((entry): entry is PublicModule => (publicModules as readonly string[]).includes(entry));
    return { profile: "custom", modules: new Set<PublicModule>(["ui", ...known]), unknown: explicit.filter((entry) => !(publicModules as readonly string[]).includes(entry)), source: "SC2_MCP_MODULES" };
  }
  const requested = env.SC2_MCP_PROFILE?.trim().toLowerCase() || "all";
  const selected = profiles[requested] ?? profiles.all;
  return { profile: profiles[requested] ? requested : "all", modules: new Set(selected), unknown: profiles[requested] ? [] : [requested], source: env.SC2_MCP_PROFILE ? "SC2_MCP_PROFILE" : "default" };
}

export function moduleProfiles() { return Object.fromEntries(Object.entries(profiles).map(([name, modules]) => [name, [...modules]])); }
