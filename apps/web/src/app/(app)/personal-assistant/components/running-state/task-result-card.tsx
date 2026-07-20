"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { ParsedConfirmationResolved, ParsedTaskResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation-resolved message rendering
//
// The orchestrator pushes a `confirmation_resolved` outbox message after the
// user approves a tool call, with body shaped like:
//
//   The user approved your earlier sokosumi_create_task request. The action
//   was executed; here's the result you can act on:
//   { ...big JSON blob... }
//
// Dumping that JSON in chat is hostile. Parse it, render the prose intro,
// and if the payload is a known shape (currently sokosumi_create_task)
// render a Task Card linking to /tasks/:id instead.

export function parseConfirmationResolved(
  content: string,
  fallbacks: {
    resolvedFallback: string;
    coworkerFallback: string;
    organizationFallback: string;
  },
): ParsedConfirmationResolved | null {
  if (!content) return null;
  // Find the first opening brace at the start of a line, take everything
  // from there as the JSON region. The intro prose is whatever comes before.
  const braceIdx = content.search(/^\s*{/m);
  if (braceIdx < 0) {
    // No JSON in the body — just return the message as-is so the caller
    // can render it as plain markdown again.
    return null;
  }
  const summary = content.slice(0, braceIdx).trim();
  const rawJson = content.slice(braceIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { summary: summary || content, task: null };
  }

  return {
    summary: summary || fallbacks.resolvedFallback,
    task: extractTaskFromConfirmation(parsed, fallbacks),
  };
}

function extractTaskFromConfirmation(
  payload: unknown,
  fallbacks: {
    coworkerFallback: string;
    organizationFallback: string;
  },
): ParsedTaskResult | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const taskWrapper = root.task as Record<string, unknown> | undefined;
  const data = (taskWrapper?.data ?? taskWrapper) as
    | Record<string, unknown>
    | undefined;
  if (!data || typeof data !== "object") return null;

  const id = typeof data.id === "string" ? data.id : null;
  const name = typeof data.name === "string" ? data.name : null;
  if (!id || !name) return null;

  const coworker = (data.assignee ?? data.coworker) as
    | Record<string, unknown>
    | null
    | undefined;
  const organization = data.organization as
    | Record<string, unknown>
    | null
    | undefined;

  return {
    id,
    name,
    description: typeof data.description === "string" ? data.description : null,
    status: typeof data.status === "string" ? data.status : null,
    credits: typeof data.credits === "number" ? data.credits : null,
    coworker: coworker
      ? {
          name:
            typeof coworker.name === "string"
              ? coworker.name
              : fallbacks.coworkerFallback,
          image: typeof coworker.image === "string" ? coworker.image : null,
        }
      : null,
    organization: organization
      ? {
          name:
            typeof organization.name === "string"
              ? organization.name
              : fallbacks.organizationFallback,
          slug:
            typeof organization.slug === "string" ? organization.slug : null,
        }
      : null,
  };
}

/**
 * A compact card for `sokosumi_create_task` results pushed via
 * `confirmation_resolved`. Replaces what would otherwise be a 60-line raw
 * JSON dump with the bits a human actually wants: name, who it's assigned
 * to, status, and a deep link.
 */
export function TaskResultCard({ task }: { task: ParsedTaskResult }) {
  const t = useTranslations("App.Hermes.Running.confirmation.taskCard");

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="border-border bg-card/60 hover:border-foreground/30 hover:bg-card group/task-card flex max-w-2xl flex-col gap-3 rounded-2xl border p-4 transition-colors"
    >
      <div className="flex items-center gap-2">
        {task.coworker?.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={task.coworker.image}
            alt=""
            className="border-border size-6 shrink-0 rounded-full border"
          />
        ) : task.coworker ? (
          <span className="bg-muted text-muted-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {task.coworker.name.charAt(0).toUpperCase()}
          </span>
        ) : null}
        <span className="text-foreground text-sm font-medium">
          {task.coworker?.name ?? t("defaultTask")}
        </span>
        {task.organization ? (
          <>
            <span className="text-tertiary-foreground text-xs">·</span>
            <span className="text-muted-foreground text-xs">
              {task.organization.name}
            </span>
          </>
        ) : null}
        {task.status ? (
          <span className="border-border/60 text-muted-foreground ml-auto rounded-full border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider">
            {task.status.toLowerCase()}
          </span>
        ) : null}
      </div>

      <div>
        <div className="text-foreground text-base font-semibold tracking-tight">
          {task.name}
        </div>
        {task.description ? (
          <p className="text-muted-foreground mt-1 line-clamp-3 text-sm leading-relaxed">
            {task.description}
          </p>
        ) : null}
      </div>

      <div className="text-muted-foreground group-hover/task-card:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors">
        <span>{t("viewTask")}</span>
        <ArrowUpRight className="size-3.5" aria-hidden />
      </div>
    </Link>
  );
}
