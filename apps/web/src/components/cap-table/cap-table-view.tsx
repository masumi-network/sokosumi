"use client";

import { PieChart } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  type CapTable,
  capTableRows,
  parseCapTable,
} from "@/lib/cap-table-file";
import { cn } from "@/lib/utils";

const SEGMENT_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
];

type LoadState =
  | { status: "loading" }
  | { status: "ready"; capTable: CapTable }
  | { status: "failed" };

/**
 * A `*.captable.json` file read from `url` and shown as a cap table.
 *
 * Plain fetch + effect, like `TeamFileView`: this also renders on the public
 * data room pages, which mount no QueryClientProvider.
 */
export function CapTableFileView({ url }: { url: string }) {
  const t = useTranslations("Components.CapTableView");
  const [state, setState] = useState<LoadState>({ status: "loading" });

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

  if (state.status === "loading")
    return (
      <div role="status" aria-label={t("loading")}>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  if (state.status === "failed")
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <PieChart aria-hidden className="text-muted-foreground size-9" />
        <p className="text-muted-foreground text-sm">{t("failed")}</p>
      </div>
    );
  return <CapTableView capTable={state.capTable} />;
}

export function CapTableView({ capTable }: { capTable: CapTable }) {
  const t = useTranslations("Components.CapTableView");
  const format = useFormatter();
  const { rows, issuedShares, fullyDilutedShares } = capTableRows(capTable);
  const shares = (value: number) => format.number(value);
  const percent = (value: number) =>
    format.number(value, {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

  return (
    <div className="grid min-w-0 gap-6">
      <header className="grid gap-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("title", { company: capTable.company })}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("asOf", {
            date: format.dateTime(new Date(`${capTable.asOf}T00:00:00Z`), {
              dateStyle: "long",
              timeZone: "UTC",
            }),
          })}
        </p>
      </header>

      <section className="grid gap-3" aria-label={t("ownership")}>
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          {rows.map((row, index) => (
            <div
              key={row.name}
              className={cn(
                SEGMENT_CLASSES[index % SEGMENT_CLASSES.length],
                row.pool && "opacity-50",
              )}
              style={{ width: `${row.fullyDiluted * 100}%` }}
            />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {rows.map((row, index) => (
            <li key={row.name} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-2.5 rounded-full",
                  SEGMENT_CLASSES[index % SEGMENT_CLASSES.length],
                  row.pool && "opacity-50",
                )}
              />
              <span>{row.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {percent(row.fullyDiluted)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-xl border-collapse text-sm">
          <thead className="bg-muted text-muted-foreground text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t("holder")}</th>
              <th className="px-3 py-2 font-medium">{t("class")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("shares")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("issued")}</th>
              <th className="px-3 py-2 text-end font-medium">
                {t("fullyDiluted")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t align-top">
                <td className="px-3 py-2.5">
                  <div className="font-medium">{row.name}</div>
                  {row.role ? (
                    <div className="text-muted-foreground">{row.role}</div>
                  ) : null}
                  {row.vesting ? (
                    <div className="text-muted-foreground text-xs">
                      {t("vesting", { schedule: row.vesting })}
                    </div>
                  ) : null}
                  {row.pool ? (
                    <div className="text-muted-foreground text-xs">
                      {t("granted", {
                        granted: shares(row.granted ?? 0),
                        available: shares(row.shares - (row.granted ?? 0)),
                      })}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  {row.shareClass ?? t("optionPool")}
                </td>
                <td className="px-3 py-2.5 text-end tabular-nums">
                  {shares(row.shares)}
                </td>
                <td className="px-3 py-2.5 text-end tabular-nums">
                  {row.issued === null ? "–" : percent(row.issued)}
                </td>
                <td className="px-3 py-2.5 text-end tabular-nums">
                  {percent(row.fullyDiluted)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold">
              <td className="px-3 py-2.5" colSpan={2}>
                {t("total")}
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums">
                {shares(fullyDilutedShares)}
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums">
                {percent(1)}
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums">
                {percent(1)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        <Fact label={t("issuedShares")} value={shares(issuedShares)} />
        {capTable.authorizedShares ? (
          <Fact
            label={t("authorizedShares")}
            value={shares(capTable.authorizedShares)}
          />
        ) : null}
        {capTable.parValue ? (
          <Fact label={t("parValue")} value={capTable.parValue} />
        ) : null}
      </dl>

      {capTable.note ? (
        <p className="text-muted-foreground text-sm">{capTable.note}</p>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
