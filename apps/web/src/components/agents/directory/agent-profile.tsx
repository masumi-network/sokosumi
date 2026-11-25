import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { BackLink } from "@/components/back-link";
import { Skeleton } from "@/components/ui/skeleton";

export interface AgentProfileSection {
  id: "what" | "work" | "settings" | "about";
  title: string;
  content: ReactNode;
}

const SECTION_ORDER: AgentProfileSection["id"][] = [
  "what",
  "work",
  "settings",
  "about",
];

interface AgentProfileProps {
  backLabel: string;
  avatar: ReactNode;
  name: string;
  /** Who owns it, or who makes it. */
  byline: ReactNode;
  /** "External" for marketplace agents; nothing for our own. */
  tag?: string;
  status?: ReactNode;
  actions: ReactNode;
  /** Sections that do not apply are left out, never shown empty. */
  sections: (AgentProfileSection | null | false)[];
}

/**
 * One profile for every kind of agent: the same header, then What it does,
 * Recent work, Settings and About, always in that order.
 */
export function AgentProfile({
  backLabel,
  avatar,
  name,
  byline,
  tag,
  status,
  actions,
  sections,
}: AgentProfileProps) {
  const shown = sections
    .filter((section): section is AgentProfileSection => Boolean(section))
    .sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id));

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-12 pb-12 md:pt-2">
      <BackLink
        href="/agents"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {backLabel}
      </BackLink>
      <header className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <span className="flex size-20 shrink-0 items-center justify-center">
          {avatar}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight text-balance md:text-3xl">
              {name}
            </h1>
            {tag ? (
              <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-medium">
                {tag}
              </span>
            ) : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>{byline}</span>
            {status}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {actions}
        </div>
      </header>
      {shown.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`agent-section-${section.id}`}
          className="border-border flex flex-col gap-4 border-t pt-8"
        >
          <h2
            id={`agent-section-${section.id}`}
            className="text-foreground text-base font-semibold"
          >
            {section.title}
          </h2>
          {section.content}
        </section>
      ))}
    </article>
  );
}

/** Label and value rows for an About section. */
export function AboutList({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-foreground min-w-0 break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The profile's shape while it loads; sync, so route shells can use it. */
export function AgentProfileSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 pb-12 md:pt-2">
      <Skeleton className="h-5 w-24" />
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <Skeleton className="size-20 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-10 w-full sm:w-36" />
      </div>
      {Array.from({ length: 2 }, (_, index) => (
        <div
          key={index}
          className="border-border flex flex-col gap-4 border-t pt-8"
        >
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}
