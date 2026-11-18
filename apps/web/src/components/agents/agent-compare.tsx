"use client";

import { Check, Plus } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { createContext, type ReactNode, use, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { getAgentName, getShortAgentAuthorName } from "@/lib/helpers/agent";
import { formatDuration } from "@/lib/utils/duration";

const MAX_COMPARED = 3;

// Static strings so Tailwind keeps them; only 2 or 3 agents reach the table.
const GRID_COLUMNS: Record<number, string> = {
  2: "grid-cols-2 md:grid-cols-[9rem_repeat(2,minmax(0,1fr))]",
  3: "grid-cols-3 md:grid-cols-[9rem_repeat(3,minmax(0,1fr))]",
};

interface AgentCompareState {
  selected: string[];
  toggle: (id: string) => void;
  clear: () => void;
}

const AgentCompareContext = createContext<AgentCompareState | null>(null);

function AgentCompareProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);
  const value = useMemo<AgentCompareState>(
    () => ({
      selected,
      toggle: (id) =>
        setSelected((ids) =>
          ids.includes(id)
            ? ids.filter((other) => other !== id)
            : ids.length < MAX_COMPARED
              ? [...ids, id]
              : ids,
        ),
      clear: () => setSelected([]),
    }),
    [selected],
  );

  return <AgentCompareContext value={value}>{children}</AgentCompareContext>;
}

/** Renders nothing outside a provider, so other agent lists stay unchanged. */
function AgentCompareToggle({ agent }: { agent: CatalogBrowseAgent }) {
  const t = useTranslations("Components.Agents.Compare");
  const compare = use(AgentCompareContext);
  if (!compare) return null;

  const isSelected = compare.selected.includes(agent.id);
  const Icon = isSelected ? Check : Plus;

  return (
    <Button
      variant="default"
      size="sm"
      aria-pressed={isSelected}
      aria-label={t("toggle", { name: getAgentName(agent) })}
      disabled={!isSelected && compare.selected.length >= MAX_COMPARED}
      onClick={() => compare.toggle(agent.id)}
    >
      <Icon className="size-4" aria-hidden />
      {t("toggleLabel")}
    </Button>
  );
}

function AgentCompareBar({ agents }: { agents: CatalogBrowseAgent[] }) {
  const t = useTranslations("Components.Agents.Compare");
  const compare = use(AgentCompareContext);
  if (!compare || compare.selected.length === 0) return null;

  // Keep the order people picked them in.
  const picked = compare.selected.flatMap((id) => {
    const agent = agents.find((candidate) => candidate.id === id);
    return agent ? [agent] : [];
  });

  return (
    <div className="bg-background border-border sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 ps-4 shadow-lg">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {picked.length < 2
          ? t("pickMore", { max: MAX_COMPARED })
          : t("picked", { count: picked.length, max: MAX_COMPARED })}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={compare.clear}>
          {t("clear")}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="primary" size="sm" disabled={picked.length < 2}>
              {t("open", { count: picked.length })}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <AgentCompareTable agents={picked} />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function AgentCompareTable({ agents }: { agents: CatalogBrowseAgent[] }) {
  const t = useTranslations("Components.Agents.Compare");
  const tDuration = useTranslations("Library.Duration.Long");
  const format = useFormatter();

  const prices = agents.flatMap((agent) =>
    agent.credits === null ? [] : [agent.credits],
  );
  const lowest = Math.min(...prices);
  // Only call a price lowest when there is something to beat.
  const marksLowest = prices.length > 1 && prices.some((p) => p > lowest);
  const notListed = (
    <span className="text-muted-foreground">{t("notListed")}</span>
  );

  const rows: {
    label: string;
    cell: (agent: CatalogBrowseAgent) => ReactNode;
  }[] = [
    {
      label: t("price"),
      cell: (agent) =>
        agent.credits === null ? (
          notListed
        ) : (
          <span className="flex flex-col items-start gap-1">
            <span className="tabular-nums">
              {t("credits", { count: agent.credits })}
            </span>
            {marksLowest && agent.credits === lowest ? (
              <span className="bg-muted rounded-md px-1.5 py-0.5 text-xs font-medium">
                {t("lowestPrice")}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      label: t("rating"),
      cell: ({ metrics: { ratings } }) =>
        ratings.total > 0 && ratings.average !== null ? (
          <span className="tabular-nums">
            {t("ratingValue", {
              average: format.number(ratings.average, {
                maximumFractionDigits: 1,
              }),
              total: ratings.total,
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("noRatings")}</span>
        ),
    },
    {
      label: t("jobsRun"),
      cell: (agent) => (
        <span className="tabular-nums">
          {format.number(agent.metrics.executions.count)}
        </span>
      ),
    },
    {
      label: t("typicalTime"),
      cell: (agent) =>
        formatDuration(agent.metrics.executions.averageTime, tDuration) ??
        notListed,
    },
    {
      label: t("madeBy"),
      cell: (agent) => getShortAgentAuthorName(agent) ?? notListed,
    },
    {
      label: t("whatItDoes"),
      cell: (agent) => agent.summary ?? agent.description ?? notListed,
    },
  ];

  // A real table laid out as a grid: on phones each row's label spans the
  // full width above its values, so two or three columns still fit 375px.
  return (
    <table
      className={`grid ${GRID_COLUMNS[agents.length] ?? GRID_COLUMNS[3]} gap-x-4 text-start text-sm`}
    >
      <caption className="sr-only">{t("title")}</caption>
      <thead className="contents">
        <tr className="contents">
          <td className="hidden md:block" />
          {agents.map((agent) => (
            <th
              key={agent.id}
              scope="col"
              className="border-border border-b pb-3 text-start font-medium break-words"
            >
              <Link
                href={`/agents/${agent.id}`}
                className="underline-offset-4 hover:underline"
              >
                {getAgentName(agent)}
              </Link>
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="contents">
        {rows.map((row) => (
          <tr key={row.label} className="contents">
            <th
              scope="row"
              className="text-muted-foreground col-span-full pt-3 text-start text-xs font-medium md:col-span-1 md:py-3 md:text-sm"
            >
              {row.label}
            </th>
            {agents.map((agent) => (
              <td
                key={agent.id}
                className="border-border border-b py-2 break-words md:py-3"
              >
                {row.cell(agent)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export { AgentCompareBar, AgentCompareProvider, AgentCompareToggle };
