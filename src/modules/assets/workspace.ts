import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Workspace } from "../../core/workspace.js";
import { VerifiedArtifactCache } from "../../core/verifiedArtifacts.js";
import { CascWorkspace, safeCascPath } from "../casc/workspace.js";
import { ModelMeasurements } from "./measurement.js";
import { readAnimationInventory, type AnimationAssetSource } from "./animationInventory.js";
import { inspectDds, decodeDds, pngThumbnail } from "./dds.js";
import { modelPage, texturePage } from "./viewer.js";

export class AssetWorkspace {
  readonly measurements: ModelMeasurements;
  private readonly previews = new VerifiedArtifactCache<{
    summary: Record<string, unknown>;
    pngFile?: string;
  }>();
  constructor(
    readonly workspace: Workspace,
    readonly casc: CascWorkspace,
  ) {
    this.measurements = new ModelMeasurements(workspace, casc);
  }
  async modelAnimationInventory(resources: string[], sources: AnimationAssetSource[]) {
    return readAnimationInventory(this.workspace, this.casc, resources, sources);
  }
  async search(
    prefix = "",
    query = "",
    kind: "all" | "texture" | "model" = "all",
    offset = 0,
    limit = 20,
  ) {
    const page = await this.casc.search(prefix, query, offset, limit);
    const items = page.items.filter((f) =>
      kind === "all"
        ? /\.(dds|m3)$/i.test(f.path)
        : f.path.endsWith(kind === "model" ? ".m3" : ".dds"),
    );
    return { ...page, items, filter: kind, filteredPage: true };
  }
  async inspect(file: string) {
    file = safeCascPath(file);
    const read = await this.casc.read(file);
    let details: unknown;
    if (file.endsWith(".dds")) details = inspectDds(read.bytes);
    else if (file.endsWith(".m3")) {
      const metadata = this.measurements.prepareMetadata(read.bytes, read.metadata.sha256);
      if (!metadata.valid) throw new Error(metadata.error);
      const totals = {
        animationCount: metadata.animations.length,
        attachmentPointCount: metadata.attachmentPoints.length,
      };
      metadata.animations = metadata.animations.slice(0, 32);
      metadata.attachmentPoints = metadata.attachmentPoints.slice(0, 64);
      try {
        const { geometry: g } = this.measurements.prepareGeometry(read.bytes, read.metadata.sha256);
        details = {
          ...metadata,
          ...totals,
          vertexCount: g.vertexCount,
          triangleCount: g.triangleCount,
          regions: g.regions,
          stride: g.stride,
          bounds: structuredClone(g.bounds),
          pose: g.pose,
          materials: false,
          geometrySupported: true,
        };
      } catch (error) {
        details = {
          ...metadata,
          ...totals,
          geometrySupported: false,
          geometryError: error instanceof Error ? error.message : String(error),
        };
      }
    } else throw new Error("ASSET_FORMAT_UNSUPPORTED");
    return {
      file,
      sha256: read.metadata.sha256,
      build: read.metadata.buildKey,
      cacheHit: read.cacheHit,
      size: read.bytes.length,
      details,
    };
  }
  async inspectMany(files: string[]) {
    if (!files.length || files.length > 24) throw Error("ASSET_INSPECT_BATCH_LIMIT");
    return this.workspace.withReadSet(async () => {
      const items: Array<Awaited<ReturnType<AssetWorkspace["inspect"]>>> = [];
      let build: string | undefined;
      for (const file of files) {
        const item = await this.inspect(file);
        if (build !== undefined && item.build !== build) throw Error("ASSET_BUILD_CHANGED");
        build = item.build;
        items.push(item);
      }
      if (build !== undefined && (await this.casc.refreshBuild()).build.buildKey !== build)
        throw Error("ASSET_BUILD_CHANGED");
      return { items, count: items.length, nativePlayback: "not_checked" as const };
    });
  }

  async preview(file: string, maxSize = 512) {
    file = safeCascPath(file);
    if (!Number.isInteger(maxSize) || maxSize < 64 || maxSize > 1024)
      throw new Error("ASSET_THUMBNAIL_SIZE");
    const read = await this.casc.read(file);
    const key = createHash("sha256")
      .update(`assets-v2:${read.metadata.buildKey}:${read.metadata.sha256}:${file}:${maxSize}`)
      .digest("hex");
    const stem = ".sc2mcp-assets-preview/" + key,
      htmlFile = this.workspace.resolveUserPath(stem + ".html");
    const hit = await this.previews.get(key + ":html", htmlFile);
    const valid =
      hit &&
      (!hit.pngFile ||
        (await this.previews.get(key + ":png", this.workspace.resolveUserPath(hit.pngFile))));
    if (valid)
      return {
        file,
        htmlFile,
        pngFile: hit.pngFile,
        sha256: read.metadata.sha256,
        build: read.metadata.buildKey,
        cacheHit: read.cacheHit,
        artifactHit: true,
        ...hit.summary,
      };
    let html: string, summary: Record<string, unknown>, pngFile: string | undefined;
    if (file.endsWith(".dds")) {
      const decoded = decodeDds(read.bytes),
        png = pngThumbnail(decoded, maxSize);
      pngFile = this.workspace.resolveUserPath(stem + ".png");
      html = texturePage(
        file,
        png.bytes,
        `${decoded.width} × ${decoded.height} · ${decoded.format}`,
      );
      summary = {
        kind: "texture",
        width: decoded.width,
        height: decoded.height,
        format: decoded.format,
        previewWidth: png.width,
        previewHeight: png.height,
      };
      await fs.mkdir(path.dirname(htmlFile), { recursive: true });
      await fs.writeFile(pngFile, png.bytes);
      this.previews.remember(key + ":png", pngFile, png.bytes, { summary: {} });
    } else if (file.endsWith(".m3")) {
      const { geometry: g } = this.measurements.prepareGeometry(read.bytes, read.metadata.sha256);
      html = modelPage(file, g);
      summary = {
        kind: "model",
        vertexCount: g.vertexCount,
        triangleCount: g.triangleCount,
        bounds: structuredClone(g.bounds),
        pose: g.pose,
        materials: false,
        animations: false,
      };
    } else throw new Error("ASSET_FORMAT_UNSUPPORTED");
    await fs.mkdir(path.dirname(htmlFile), { recursive: true });
    await fs.writeFile(htmlFile, html, "utf8");
    this.previews.remember(key + ":html", htmlFile, Buffer.from(html), { summary, pngFile });
    return {
      file,
      htmlFile,
      pngFile,
      sha256: read.metadata.sha256,
      build: read.metadata.buildKey,
      cacheHit: read.cacheHit,
      artifactHit: false,
      ...summary,
    };
  }
}
