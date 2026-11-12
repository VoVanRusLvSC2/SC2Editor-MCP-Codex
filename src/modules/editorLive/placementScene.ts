import * as z from "zod/v4";

export const placementObjectSchema = z.object({
  row: z.number().int().nonnegative(), key: z.string().regex(/^\d+$/),
  type: z.string(), name: z.string(),
});
export const placementSceneSchema = z.object({
  layer: z.enum(["Doodads", "Units"]).default("Doodads"),
  count: z.number().int().min(0).max(8192), selectedKey: z.string(),
  sceneHash: z.string(), preview: z.string(), objects: z.array(placementObjectSchema).max(8192),
});
const pageSchema = placementSceneSchema.extend({
  offset: z.number().int().min(0).max(8192),
  objects: z.array(placementObjectSchema).max(128),
});

/** Reassemble a complete inventory only when every native page describes the same scene. */
export async function readPlacementScenePages(read: (offset: number, expected: string) => Promise<unknown>) {
  let offset = 0, initial: z.infer<typeof pageSchema> | undefined;
  const objects: z.infer<typeof placementObjectSchema>[] = [], keys = new Set<string>();
  for (;;) {
    const page = pageSchema.parse(await read(offset, initial?.sceneHash ?? ""));
    if (page.offset !== offset || offset > page.count || offset + page.objects.length > page.count ||
        (offset < page.count && !page.objects.length) ||
        (initial && (page.sceneHash !== initial.sceneHash || page.count !== initial.count ||
          page.layer !== initial.layer || page.selectedKey !== initial.selectedKey || page.preview !== initial.preview)))
      throw Error("LIVE_PLACEMENT_SCENE_PAGE_CHANGED");
    initial ??= page;
    for (const object of page.objects) {
      if (object.row !== objects.length || keys.has(object.key))
        throw Error("LIVE_PLACEMENT_SCENE_PAGE_INVALID");
      keys.add(object.key); objects.push(object);
    }
    offset = objects.length;
    if (offset === page.count) return placementSceneSchema.parse({ ...initial, objects });
  }
}
