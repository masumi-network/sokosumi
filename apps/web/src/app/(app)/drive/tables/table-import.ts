import { tableBatchSchema, type tableInsertRowSchema } from "@sokosumi/utils";
import type { z } from "zod";

/** Deterministic chunks leave headroom for the Core operation envelope as well as HTTP JSON. */
export function tableImportBatches(
  key: string,
  rows: z.infer<typeof tableInsertRowSchema>[],
) {
  const batches: z.infer<typeof tableBatchSchema>[] = [];
  let offset = 0;
  while (offset < rows.length) {
    const batch: z.infer<typeof tableBatchSchema> = {
      key: `${key}:${offset}`,
      insert: [],
      patch: [],
    };
    while (offset < rows.length && batch.insert.length < 100) {
      batch.insert.push(rows[offset]);
      if (
        new TextEncoder().encode(JSON.stringify(batch)).byteLength > 990_000
      ) {
        batch.insert.pop();
        if (!batch.insert.length)
          throw new Error("Table requests are limited to 1 MB");
        break;
      }
      offset++;
    }
    batches.push(tableBatchSchema.parse(batch));
  }
  return batches;
}
