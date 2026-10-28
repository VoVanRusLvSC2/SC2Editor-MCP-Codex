/** Operation inventory is shared by tool registration and capability summaries. */
export const nativeTerrainTools = {
  cliffPaint: "terrain.cliff.paint",
  rampCreate: "terrain.ramp.create",
  rampRemove: "terrain.ramp.remove",
  rampPlace: "terrain.ramp.place",
  pathingPaint: "terrain.pathing.paint",
  pathingFill: "terrain.pathing.fill",
  navigationPreview: "terrain.navigation.preview",
} as const;

export const terrainCapabilityManifest = {
  operations: Object.values(nativeTerrainTools),
  support: [
    "Version-checked terrain codecs, coherent height/texture/water plans and seeded landscape composition",
    "Native cliff painting and qualified cardinal/diagonal ramp workflows, including guarded template transfer and adjoining-level preparation",
    "CellAttribute no-path/no-building/clear-path masks, scalar color/fluff records and ModKit static navigation previews",
    "Tracked terrain + object + component-registration transactions, ownership and manual-edit protection",
  ],
  gaps: [
    "Arbitrary cliff/ramp combinations and format versions are not universally accepted by the engine",
    "Painted masks and static navigation do not certify effective engine movement, footprints or live unit state",
    "Full time-of-day, water shoreline-wave and engine-rendered preview semantics retain explicit limits",
  ],
  verification: {
    static: "Per-request validation and format-specific checks",
    editor: "Use revision-bound native evidence for the selected case",
    rendered: "Review the actual retained image; a successful render call alone is insufficient",
    gameplay: "Use explicit route, passability and action checks on the tested artifact",
    universalEngineAcceptance: false,
  },
};
