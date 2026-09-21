export interface Point2 {
  x: number;
  y: number;
}
export type TerrainArea =
  | {
      type: "rectangle";
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    }
  | { type: "circle"; center: Point2; radius: number }
  | { type: "polygon"; points: Point2[] }
  | { type: "corridor"; points: Point2[]; width: number };
export interface Brush {
  strength?: number;
  edgeBlend?: number;
  protectedAreas?: TerrainArea[];
}
export type TerrainStyle =
  | "forest"
  | "desert"
  | "city"
  | "snow"
  | "jungle"
  | "swamp"
  | "volcanic"
  | "badlands"
  | "coastal"
  | "space_platform";
export type TerrainOperation =
  | { op: "lighting.assign"; id: string }
  | ({ op: "lighting.preset" } & import("./lighting.js").LightingPatch)
  | ({
      op: "height.raise" | "height.lower";
      area: TerrainArea;
      amount: number;
    } & Brush)
  | ({
      op: "height.set" | "height.flatten";
      area: TerrainArea;
      height: number | "currentMedian";
    } & Brush)
  | ({
      op: "height.smooth";
      area: TerrainArea;
      radius?: number;
      iterations?: number;
      method?: "gaussian" | "edge_preserving";
      edgeThreshold?: number;
    } & Brush)
  | ({
      op: "height.noise";
      area: TerrainArea;
      amplitude: number;
      wavelength?: number;
      seed?: number;
    } & Brush)
  | ({
      op: "height.slope";
      area: TerrainArea;
      from: Point2;
      to: Point2;
      fromHeight: number;
      toHeight: number;
    } & Brush)
  | ({
      op: "texture.paint" | "texture.blend";
      area: TerrainArea;
      texture: string;
    } & Brush)
  | ({
      op: "texture.replace";
      area: TerrainArea;
      fromTexture: string;
      texture: string;
    } & Brush)
  | ({ op: "texture.smooth"; area: TerrainArea; radius?: number } & Brush)
  | ({
      op: "texture.paint_rules";
      area: TerrainArea;
      rules: Array<{
        texture: string;
        minHeight?: number;
        maxHeight?: number;
        minSlope?: number;
        maxSlope?: number;
      }>;
    } & Brush)
  | {
      op: "palette.update";
      replacements: Array<{ slot: number; texture: string }>;
    }
  | {
      op: "water.create";
      area: Extract<TerrainArea, { type: "rectangle" }>;
      sourceIndex?: number;
      template?: string;
    }
  | {
      op: "water.update";
      index: number;
      template?: string;
      area: Extract<TerrainArea, { type: "rectangle" }>;
    }
  | ({ op: "water.material" } & import("./waterCatalog.js").WaterMaterialPatch)
  | { op: "water.remove"; index: number }
  | { op: "stamp.apply"; donorDirectory: string }
  | {
      op: "cliff.paint" | "ramp.create" | "ramp.remove" | "pathing.paint";
      area?: TerrainArea;
      parameters: Record<string, unknown>;
    };
export interface TerrainIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}
export interface TerrainPlanRequest {
  directory?: string;
  operations: TerrainOperation[];
  maxSlope?: number;
}
export interface TerrainPlanSummary {
  id: string;
  directory: string;
  operations: TerrainOperation[];
  files: Array<{
    file: string;
    beforeSha256: string;
    afterSha256: string;
    changedBytes: number;
    beforeBytes: number;
    afterBytes: number;
  }>;
  issues: TerrainIssue[];
  valid: boolean;
  changedVertices: number;
  changedTexturePixels: number;
  evidence: string[];
  sourceSha256: Record<string, string>;
  diskSha256: Record<string, string>;
  nativeEditorVerified: false;
}
