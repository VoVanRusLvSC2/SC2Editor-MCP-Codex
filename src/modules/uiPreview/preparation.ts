import { createHash } from "node:crypto";
import { XmlParseCache } from "../../core/xmlParseCache.js";
import { PreparedValueCache } from "../../core/preparedValues.js";
import { decodeDds } from "../assets/dds.js";

/** Retained pure preparation only. PreviewSources still reads and records all
 * current source files and validates the CASC build for each preview. */
export class UiPreviewPreparation {
  private readonly documents = new XmlParseCache(3, 8 * 1024 * 1024);
  private readonly textures = new PreparedValueCache<ReturnType<typeof decodeDds>>(
    32,
    64 * 1024 * 1024,
  );
  private decodes = 0;
  xml(source: string) {
    return this.documents.read(source);
  }
  texture(bytes: Buffer): ReturnType<typeof decodeDds> {
    const key = createHash("sha256").update(bytes).digest("hex"),
      cached = this.textures.get(key);
    if (cached) return { ...cached, rgba: Buffer.from(cached.rgba) };
    const decoded = decodeDds(bytes);
    this.decodes++;
    this.textures.set(key, decoded, decoded.rgba.length);
    return decoded;
  }
  stats() {
    return { xml: this.documents.stats(), textures: this.textures.stats(), decodes: this.decodes };
  }
}
