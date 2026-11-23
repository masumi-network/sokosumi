"use client";

import { useEffect, useState } from "react";
import { type CapTable, parseCapTable } from "@/lib/cap-table-file";

export type CapTableFileLoadState =
  | { status: "loading" }
  | { status: "ready"; capTable: CapTable }
  | { status: "failed" };

/**
 * Fetches and parses a `*.captable.json` document from `url` with
 * `AbortController` cleanup for `CapTableFileView`.
 */
export function useCapTableFile(url: string): CapTableFileLoadState {
  const [state, setState] = useState<CapTableFileLoadState>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to fetch cap table");
        return response.json();
      })
      .then((json: unknown) => {
        const capTable = parseCapTable(json);
        setState(
          capTable ? { status: "ready", capTable } : { status: "failed" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [url]);

  return state;
}
