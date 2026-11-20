"use client";

import { Sheet as SheetIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MAX_ROWS,
  readSpreadsheet,
  type Spreadsheet,
} from "@/lib/spreadsheet-file";
import { cn } from "@/lib/utils";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; sheets: Spreadsheet[] }
  | { status: "failed" };

/**
 * An `.xlsx` or `.csv` read from `url` and shown as a table.
 *
 * Plain fetch + effect, like `TeamFileView`: this also renders on the public
 * data room pages, which mount no QueryClientProvider.
 */
export function SpreadsheetFileView({
  url,
  kind,
}: {
  url: string;
  kind: "xlsx" | "csv";
}) {
  const t = useTranslations("Components.SpreadsheetView");
  const [state, setState] = useState<LoadState>({ status: "loading" });

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

  if (state.status === "loading")
    return (
      <div role="status" aria-label={t("loading")}>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  if (state.status === "failed")
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <SheetIcon aria-hidden className="text-muted-foreground size-9" />
        <p className="text-muted-foreground text-sm">{t("failed")}</p>
      </div>
    );
  return <SpreadsheetView sheets={state.sheets} />;
}

export function SpreadsheetView({ sheets }: { sheets: Spreadsheet[] }) {
  const t = useTranslations("Components.SpreadsheetView");
  const [active, setActive] = useState(0);
  const sheet = sheets[active] ?? sheets[0];
  if (!sheet) return null;

  return (
    <div className="grid min-w-0 gap-3">
      {sheets.length > 1 ? (
        <Tabs
          value={String(active)}
          onValueChange={(v) => setActive(Number(v))}
        >
          <TabsList className="max-w-full overflow-x-auto">
            {sheets.map((item, index) => (
              <TabsTrigger key={`${item.name}-${index}`} value={String(index)}>
                {item.name || t("sheet", { number: index + 1 })}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {sheet.images.map((src, index) => (
        // Not `next/image`: a data URL read from the workbook, not an asset.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          // Pictures have no identity beyond their place on the sheet.
          key={index}
          src={src}
          alt={sheet.name || t("sheet", { number: active + 1 })}
          className="max-w-full rounded-md border"
        />
      ))}

      {sheet.rows.length === 0 ? (
        sheet.images.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : null
      ) : (
        <div className="max-h-[70dvh] overflow-auto rounded-md border">
          <table className="w-max min-w-full border-collapse text-sm">
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr
                  // Rows have no identity beyond their place in the sheet.
                  key={rowIndex}
                  className="border-b last:border-b-0"
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cn(
                        "max-w-80 border-e px-3 py-1.5 align-top whitespace-pre-wrap last:border-e-0",
                        cell.numeric &&
                          "text-end tabular-nums whitespace-nowrap",
                        cell.bold && "font-semibold",
                      )}
                    >
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sheet.truncated ? (
        <p className="text-muted-foreground text-xs">
          {t("truncated", { rows: MAX_ROWS })}
        </p>
      ) : null}
    </div>
  );
}
