"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ArrowUpRight, SearchCheck } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

/** One titled holder. Every SEO section uses it, so titles, help text and actions line up across tabs. */
export function SeoSection({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cn(HOLDER_CLASS, "min-w-0 space-y-2")}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-2 pt-1">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function SeoEmpty({
  title,
  body,
  description,
  children,
}: {
  title?: string;
  body?: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn(HOLDER_ITEM_CLASS, "px-4 py-8")}>
      <EmptyState
        icon={SearchCheck}
        title={title}
        description={body ?? description ?? ""}
        action={children}
      />
    </div>
  );
}

export function SeoPageLink({
  url,
  label,
}: {
  url: string;
  label?: string | null;
}) {
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-w-0 items-start gap-1 text-sm underline-offset-4 hover:underline"
    >
      <bdi className="break-all">{label || url}</bdi>
      <ArrowUpRight className="mt-0.5 size-3 shrink-0" aria-hidden />
    </Link>
  );
}

export function SeoDate({
  value,
  timeZone,
}: {
  value: string | Date | null;
  timeZone?: string;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  if (!value) return <span>{t("none")}</span>;
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time dateTime={date.toISOString()}>
      {format.dateTime(
        date,
        "dateTimeMedium",
        timeZone ? { timeZone } : undefined,
      )}
    </time>
  );
}

/** A reporting period of calendar days, shown as the provider's dates without a time zone shift. */
export function SeoPeriod({ from, to }: { from: string; to: string }) {
  const format = useFormatter();
  const day = (value: string) => new Date(`${value}T12:00:00Z`);
  // The locale picks the range form and its separator.
  return (
    <span>
      {format.dateTimeRange(day(from), day(to), {
        dateStyle: "medium",
        timeZone: "UTC",
      })}
    </span>
  );
}

export function SeoSource({
  observationId,
  workspace,
}: {
  observationId: string;
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo");
  const observation = workspace.observations.find(
    (item) => item.id === observationId,
  );
  return observation?.sourceTaskId ? (
    <Link
      href={`/tasks/${encodeURIComponent(observation.sourceTaskId)}`}
      className="text-xs underline underline-offset-4"
    >
      {t("openEvidence")}
    </Link>
  ) : null;
}

/** A quiet state label; the numbers and the next action stay the loudest marks. */
export function SeoState({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground whitespace-normal font-normal"
    >
      {children}
    </Badge>
  );
}
