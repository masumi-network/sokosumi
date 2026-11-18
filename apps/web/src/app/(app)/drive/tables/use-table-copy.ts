"use client";

import type { createDataTableSchema, tableBatchSchema } from "@sokosumi/utils";
import { useLayoutEffect, useRef, useState } from "react";
import type { z } from "zod";
import { dataTableService } from "@/lib/services/data-table.client";

/** A new Files Table and its rows, keyed so a retry creates and inserts nothing twice. */
export type TableCopyPlan = {
  table: z.infer<typeof createDataTableSchema>;
  batches: z.infer<typeof tableBatchSchema>[];
};

type Attempt = {
  plan: TableCopyPlan;
  workspace?: string;
  tableId?: string;
  done: number;
};

const rowCount = (plan: TableCopyPlan) =>
  plan.batches.reduce((sum, b) => sum + b.insert.length, 0);

/**
 * Copies rows into a new Files Table. The plan is built on the first press only: a failed copy finishes on the
 * next press with the same Table and the batches not yet saved, under the same keys, or is discarded to start over.
 * `copy` throws when a request fails and returns the new Table's id and how many rows it holds.
 *
 * Given a `workspace` (an organization id, or `personal`), every request names it, and Core writes nothing once the
 * active workspace differs. A switch also fences the page: a saved copy, its pending state and its outcome belong to
 * the workspace it was confirmed in, so after a switch `copy` returns null and the next copy starts fresh.
 */
export function useTableCopy(workspace?: string) {
  const [pendingIn, setPendingIn] = useState<string | null>(null);
  /**
   * A copy failed part way: the next press finishes this one, the rows planned then into the Table titled then,
   * whatever the page shows now. `tableCreated`: the Table is already in Files, with any rows saved so far.
   */
  const [unfinished, setUnfinished] = useState<{
    rows: number;
    title: string;
    tableCreated: boolean;
    workspace?: string;
  } | null>(null);
  const attempt = useRef<Attempt | null>(null);
  // The workspace the page shows now, read after a request returns.
  const latest = useRef(workspace);
  useLayoutEffect(() => {
    latest.current = workspace;
  }, [workspace]);

  function discard() {
    attempt.current = null;
    setUnfinished(null);
  }

  async function copy(plan: () => TableCopyPlan) {
    if (attempt.current && attempt.current.workspace !== workspace)
      attempt.current = null;
    attempt.current ??= { plan: plan(), workspace, done: 0 };
    const current = attempt.current;
    const key = current.workspace ?? "";
    setPendingIn(key);
    try {
      current.tableId ??= (
        await dataTableService.create(current.plan.table, current.workspace)
      ).id;
      // One batch at a time, in order: a retry resumes at the first batch not saved.
      for (; current.done < current.plan.batches.length; current.done++)
        await dataTableService.batch(
          current.tableId,
          current.plan.batches[current.done],
          current.workspace,
        );
      if (attempt.current === current) discard();
      if (latest.current !== current.workspace) return null;
      return { id: current.tableId, rows: rowCount(current.plan) };
    } catch (error) {
      if (latest.current !== current.workspace) {
        if (attempt.current === current) discard();
        return null;
      }
      setUnfinished({
        rows: rowCount(current.plan),
        title: current.plan.table.title,
        tableCreated: current.tableId !== undefined,
        workspace: current.workspace,
      });
      throw error;
    } finally {
      setPendingIn((now) => (now === key ? null : now));
    }
  }

  return {
    pending: pendingIn === (workspace ?? ""),
    unfinished: unfinished?.workspace === workspace ? unfinished : null,
    copy,
    discard,
  };
}
