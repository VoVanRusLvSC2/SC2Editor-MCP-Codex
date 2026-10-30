import type { DataDocument } from "./document.js";
import type { DataObject } from "./types.js";

export interface CatalogIndexRecord {
  file: string;
  document: DataDocument;
  layer: "workspace" | "dependency";
  engineActive?: boolean;
}

export interface CatalogIndexedObject extends DataObject {
  file: string;
  layer: "workspace" | "dependency";
}

/** One transaction's object view. Rebuild the index after edits or activation changes.
 * Public DataDocument.objects() keeps its independent mutable return values.
 */
export class CatalogObjectIndex {
  readonly objects: CatalogIndexedObject[] = [];
  readonly activeByDomainId = new Map<string, DataObject[]>();
  private readonly documents = new Map<DataDocument, { source: string; objects: DataObject[] }>();
  private readonly snapshotsByFile = new Map<
    string,
    Map<string, { source: string; objects: DataObject[] }>
  >();
  private readonly records: Array<CatalogIndexRecord & { source: string }>;

  constructor(records: readonly CatalogIndexRecord[], reuseUnchanged?: CatalogObjectIndex) {
    this.records = records.map((record) => ({ ...record, source: record.document.source }));
    for (const record of records) {
      let snapshot = this.documents.get(record.document);
      if (!snapshot) {
        // Discovery can evict/recreate a DataDocument when its bounded parse
        // cache fills. Equal source AND sourceFile retain identical object spans.
        const previous = reuseUnchanged?.snapshotsByFile
          .get(record.document.sourceFile)
          ?.get(record.document.source);
        snapshot =
          previous?.source === record.document.source
            ? previous
            : { source: record.document.source, objects: record.document.objects() };
        this.documents.set(record.document, snapshot);
        let bySource = this.snapshotsByFile.get(record.document.sourceFile);
        if (!bySource) this.snapshotsByFile.set(record.document.sourceFile, (bySource = new Map()));
        bySource.set(snapshot.source, snapshot);
      }
      for (const object of snapshot.objects) {
        this.objects.push({ ...object, file: record.file, layer: record.layer });
        if (record.engineActive === false) continue;
        const key = object.domain + "\0" + object.id;
        const matches = this.activeByDomainId.get(key);
        if (matches) matches.push(object);
        else this.activeByDomainId.set(key, [object]);
      }
    }
  }

  assertMatches(records: readonly CatalogIndexRecord[]): void {
    if (
      records.length !== this.records.length ||
      records.some((record, i) => {
        const saved = this.records[i];
        return (
          record.document !== saved.document ||
          record.file !== saved.file ||
          record.layer !== saved.layer ||
          record.engineActive !== saved.engineActive ||
          record.document.source !== saved.source
        );
      })
    )
      throw new Error("STALE_DATA_CATALOG_INDEX");
  }

  objectsFor(document: DataDocument): DataObject[] {
    const saved = this.documents.get(document);
    if (!saved) return document.objects();
    if (document.source !== saved.source) throw new Error("STALE_DATA_CATALOG_INDEX");
    return saved.objects;
  }

  activeMatches(domain: string | undefined, id: string): DataObject[] {
    return this.activeByDomainId.get(domain + "\0" + id) ?? [];
  }
}
