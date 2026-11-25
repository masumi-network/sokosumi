import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { BackLink } from "@/components/back-link";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { AgentsPageHeader, AgentsSection } from "./agents-page";
import { AGENTS_CARD_CLASS, AGENTS_PAGE_CLASS } from "./agents-page-classes";

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

const BACK_LINK_CLASS =
  "text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 px-1 text-sm transition-colors";

/**
 * One profile for every kind of agent, drawn like the Agents page: the same
 * header, then What it does, Recent work, Settings and About as sections.
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
    <article className={AGENTS_PAGE_CLASS}>
      <div className="flex flex-col gap-4">
        <BackLink href="/agents" className={BACK_LINK_CLASS}>
          <ArrowLeft aria-hidden className="size-4" />
          {backLabel}
        </BackLink>
        <AgentsPageHeader
          leading={avatar}
          title={name}
          tag={tag}
          subtitle={
            <>
              <span>{byline}</span>
              {status}
            </>
          }
          actions={actions}
        />
      </div>
      {shown.map((section) => (
        <AgentsSection
          key={section.id}
          id={`agent-section-${section.id}`}
          title={section.title}
        >
          {section.content}
        </AgentsSection>
      ))}
    </article>
  );
}

/** Running text in a white card, kept to a readable line length. */
export function ProfileText({ children }: { children: ReactNode }) {
  return (
    <div className={AGENTS_CARD_CLASS}>
      <div className="text-foreground max-w-prose text-sm leading-relaxed text-pretty">
        {children}
      </div>
    </div>
  );
}

/** Facts as white tiles: label above value, more columns as the page widens. */
export function AboutList({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {rows.map((row) => (
        <div
          key={row.label}
          className={cn(AGENTS_CARD_CLASS, "flex min-w-0 flex-col gap-1")}
        >
          <dt className="text-muted-foreground text-xs font-medium">
            {row.label}
          </dt>
          <dd className="text-foreground min-w-0 text-sm break-words">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The profile's shape while it loads; sync, so route shells can use it. */
export function AgentProfileSkeleton() {
  return (
    <div className={AGENTS_PAGE_CLASS}>
      <div className="flex flex-col gap-4 px-1">
        <Skeleton className="h-5 w-24" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className="flex flex-col gap-4">
          <Skeleton className="mx-1 h-6 w-32" />
          <div className={HOLDER_CLASS}>
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
