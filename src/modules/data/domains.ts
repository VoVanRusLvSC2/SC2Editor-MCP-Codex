// Catalog domain prefixes recovered from public SC2 GameData/tooling. The set is
// deliberately open: unknown C* entry types remain lossless and receive no domain.
export const DATA_CATALOG_DOMAINS = [
  "Abil", "Accumulator", "Achievement", "AchievementTerm", "Actor", "ActorSupport", "Alert",
  "ArmyCategory", "ArmyUnit", "ArmyUpgrade", "Artifact", "ArtifactSlot", "AttachMethod",
  "BankCondition", "Beam", "Behavior", "Boost", "Bundle", "Button", "Camera", "Campaign",
  "Character", "Cliff", "CliffMesh", "ColorStyle", "Commander", "Config", "ConsoleSkin",
  "Conversation", "ConversationState", "Cursor", "DSP", "DataCollection", "DataCollectionPattern",
  "DecalPack", "Effect", "Emoticon", "EmoticonPack", "Error", "Footprint", "FoW", "Game",
  "GameUI", "Herd", "HerdNode", "Hero", "HeroAbil", "HeroStat", "Item", "ItemClass",
  "ItemContainer", "Kinetic", "LensFlareSet", "Light", "Location", "Loot", "Map", "Model",
  "Mount", "Mover", "Objective", "PhysicsMaterial", "Ping", "PlayerResponse", "PortraitPack",
  "Preload", "PremiumMap", "Race", "RaceBannerPack", "Requirement", "RequirementNode", "Reverb",
  "Reward", "ScoreResult", "ScoreValue", "Shape", "Skin", "SkinPack", "Sound", "SoundExclusivity",
  "SoundMixSnapshot", "Soundtrack", "Spray", "SprayPack", "StimPack", "TacCooldown", "Tactical",
  "Talent", "TalentProfile", "TargetFind", "TargetSort", "Terrain", "TerrainObject", "TerrainTex",
  "Texture", "TextureSheet", "Tile", "Trophy", "Turret", "Unit", "Upgrade", "User", "Validator",
  "VoiceOver", "VoicePack", "WarChest", "WarChestSeason", "Water", "Weapon",
] as const;

const domains = [...DATA_CATALOG_DOMAINS].sort((left, right) => right.length - left.length);
// Native subclasses omit "Node" from their names, although their catalog is
// RequirementNode. Keep them separate from the owning CRequirement catalog.
const requirementNodes = new Set([
  'AllowAbil', 'AllowBehavior', 'AllowUnit', 'AllowUpgrade', 'And', 'Const',
  'CountAbil', 'CountBehavior', 'CountEffect', 'CountUnit', 'CountUpgrade',
  'Div', 'Eq', 'GT', 'GTE', 'LT', 'LTE', 'Mod', 'Mul', 'NE', 'Node',
  'Not', 'Odd', 'Or', 'Sum', 'Xor',
].map(suffix => 'CRequirement' + suffix));

export function dataDomainFromType(ctype: string): string | undefined {
  if (!/^C[A-Z]/.test(ctype)) return undefined;
  if (requirementNodes.has(ctype)) return 'RequirementNode';
  const body = ctype.slice(1);
  return domains.find((domain) => body.startsWith(domain));
}

export function isDataObjectType(ctype: string): boolean { return /^C[A-Z]/.test(ctype); }

