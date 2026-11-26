import type { createDataTableSchema, tableBatchSchema } from "@sokosumi/utils";
import type { z } from "zod";
import { dataTableService } from "@/lib/services/data-table.client";

/** A planned copy into a new Files Table, and how far it got. */
export type TableCopy = {
  plan: {
    table: z.infer<typeof createDataTableSchema>;
    batches: z.infer<typeof tableBatchSchema>[];
  };
  tableId?: string;
  /** Batches saved so far. */
  done: number;
};

/**
 * Creates the Table once, then saves one batch at a time, in order. A failed copy finishes on the next call
 * with the same `copy`: the same Table and the batches not yet saved, under the same keys.
 */
export async function finishTableCopy(copy: TableCopy) {
  copy.tableId ??= (await dataTableService.create(copy.plan.table)).id;
  for (; copy.done < copy.plan.batches.length; copy.done++)
    await dataTableService.batch(copy.tableId, copy.plan.batches[copy.done]);
  return copy.tableId;
}

/** Rows saved so far and in all. */
export function tableCopyRows({ plan, done }: TableCopy) {
  const count = (batches: TableCopy["plan"]["batches"]) =>
    batches.reduce((sum, batch) => sum + batch.insert.length, 0);
  return {
    saved: count(plan.batches.slice(0, done)),
    total: count(plan.batches),
  };
}
