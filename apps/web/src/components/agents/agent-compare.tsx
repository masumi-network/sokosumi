"use client";

import { Check, Plus } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useMemo,
  useRef,
  useState,
} from "react";
import { mobileCreateFabBottom } from "@/app/components/mobile-create-fab-geometry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChipRemoveButton } from "@/components/ui/chip-remove-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { getAgentName, getShortAgentAuthorName } from "@/lib/helpers/agent";
import { cn } from "@/lib/utils";
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

function AgentCompareBar({
  agents,
  returnFocusTo,
}: {
  agents: CatalogBrowseAgent[];
  /** Takes focus when the last pick goes, since the bar unmounts. */
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("Components.Agents.Compare");
  const compare = use(AgentCompareContext);
  const clearRef = useRef<HTMLButtonElement>(null);
  const isApple = useIsApplePlatform();
  if (!compare || compare.selected.length === 0) return null;

  // Keep the order people picked them in.
  const picked = compare.selected.flatMap((id) => {
    const agent = agents.find((candidate) => candidate.id === id);
    return agent ? [agent] : [];
  });

  const clear = () => {
    compare.clear();
    returnFocusTo.current?.focus();
  };
  // A pick's card may be hidden by a filter, so the bar can remove it too.
  const remove = (id: string) => {
    if (compare.selected.length === 1) return clear();
    compare.toggle(id);
    clearRef.current?.focus();
  };

  return (
    <div
      className={cn(
        "bg-background border-border sticky z-10 flex flex-col gap-2 rounded-xl border p-2 ps-4 shadow-lg md:bottom-3 md:flex-row md:items-center md:justify-between",
        // Phones: clear the floating tab bar, which the scroll area runs under.
        mobileCreateFabBottom(isApple),
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {picked.length < 2
            ? t("pickMore", { max: MAX_COMPARED })
            : t("picked", { count: picked.length, max: MAX_COMPARED })}
        </p>
        <ul className="flex flex-wrap gap-2" aria-label={t("pickedList")}>
          {picked.map((agent) => (
            <li key={agent.id} className="min-w-0">
              <Badge
                variant="secondary"
                className="max-w-full gap-1 overflow-visible py-0 pe-0"
              >
                <span className="truncate">{getAgentName(agent)}</span>
                <ChipRemoveButton
                  aria-label={t("remove", { name: getAgentName(agent) })}
                  onClick={() => remove(agent.id)}
                />
              </Badge>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button ref={clearRef} variant="ghost" size="sm" onClick={clear}>
          {t("clear")}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="primary" size="sm" disabled={picked.length < 2}>
              {t("open", { count: picked.length })}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-[min(48rem,calc(100%-2rem))]">
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
  const notListed = (
    <span className="text-muted-foreground">{t("notListed")}</span>
  );

  const rows: {
    label: string;
    cell: (agent: CatalogBrowseAgent) => ReactNode;
  }[] = [
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
      label: t("categories"),
      cell: (agent) =>
        agent.categories.length > 0
          ? agent.categories.map((category) => category.name).join(", ")
          : notListed,
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
