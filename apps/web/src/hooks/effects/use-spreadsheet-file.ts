"use client";

import { useEffect, useState } from "react";
import { readSpreadsheet, type Spreadsheet } from "@/lib/spreadsheet-file";

export type SpreadsheetFileLoadState =
  | { status: "loading" }
  | { status: "ready"; sheets: Spreadsheet[] }
  | { status: "failed" };

/**
 * Fetches and parses an `.xlsx` or `.csv` workbook from `url` with
 * `AbortController` cleanup for `SpreadsheetFileView`.
 */
export function useSpreadsheetFile(
  url: string,
  kind: "xlsx" | "csv",
): SpreadsheetFileLoadState {
  const [state, setState] = useState<SpreadsheetFileLoadState>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to fetch spreadsheet");
        return response.arrayBuffer();
      })
      .then((bytes) => readSpreadsheet(kind, bytes))
      .then((sheets) =>
        setState(
          sheets.length > 0
            ? { status: "ready", sheets }
            : { status: "failed" },
        ),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [url, kind]);

  return state;
}
