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

export function SeoSection({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cn(HOLDER_CLASS, "min-w-0 space-y-2")}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
        <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
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

export function SeoState({ children }: { children: ReactNode }) {
  return (
    <Badge variant="secondary" className="whitespace-normal font-normal">
      {children}
    </Badge>
  );
}
