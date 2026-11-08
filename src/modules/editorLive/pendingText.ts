import * as z from "zod/v4";
import { PendingComponent } from "./pendingComponent.js";

const recordSchema = z
  .object({
    id: z.string().uuid(),
    archive: z.string().min(1).max(4096),
    processId: z.number().int().positive(),
    processStart: z.string().regex(/^\d+$/).max(128),
    locale: z.string().regex(/^[a-z]{2}[A-Z]{2}$/),
    archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
    expectedFile: z.string().min(1).max(4096),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PendingTextRecord = z.infer<typeof recordSchema>;

/** Cross-session guard for the original locale export cache. */
export class PendingText extends PendingComponent<PendingTextRecord> {
  constructor() {
    super("pending-text", recordSchema, "LIVE_TEXT_PENDING");
  }
}
