"use client";

import type { createDataTableSchema, tableBatchSchema } from "@sokosumi/utils";
import { useRef, useState } from "react";
import type { z } from "zod";
import { dataTableService } from "@/lib/services/data-table.client";

/** A new Files Table and its rows, keyed so a retry creates and inserts nothing twice. */
export type TableCopyPlan = {
  table: z.infer<typeof createDataTableSchema>;
  batches: z.infer<typeof tableBatchSchema>[];
};

const rowCount = (plan: TableCopyPlan) =>
  plan.batches.reduce((sum, b) => sum + b.insert.length, 0);

/**
 * Copies rows into a new Files Table. The plan is built on the first press only: a failed copy finishes on the
 * next press with the same Table and the batches not yet saved, under the same keys. `copy` throws when a request
 * fails and returns the new Table's id and how many rows it holds.
 */
export function useTableCopy() {
  const [pending, setPending] = useState(false);
  /**
   * A copy failed part way: the next press finishes this one, the rows planned then into the Table titled then,
   * whatever the page shows now.
   */
  const [unfinished, setUnfinished] = useState<{
    rows: number;
    title: string;
  } | null>(null);
  const attempt = useRef<{
    plan: TableCopyPlan;
    tableId?: string;
    done: number;
  } | null>(null);

  async function copy(plan: () => TableCopyPlan) {
    setPending(true);
    try {
      attempt.current ??= { plan: plan(), done: 0 };
      const current = attempt.current;
      current.tableId ??= (
        await dataTableService.create(current.plan.table)
      ).id;
      // One batch at a time, in order: a retry resumes at the first batch not saved.
      for (; current.done < current.plan.batches.length; current.done++)
        await dataTableService.batch(
          current.tableId,
          current.plan.batches[current.done],
        );
      attempt.current = null;
      setUnfinished(null);
      return { id: current.tableId, rows: rowCount(current.plan) };
    } catch (error) {
      const { plan } = attempt.current ?? {};
      if (plan)
        setUnfinished({ rows: rowCount(plan), title: plan.table.title });
      throw error;
    } finally {
      setPending(false);
    }
  }

  return { pending, unfinished, copy };
}
