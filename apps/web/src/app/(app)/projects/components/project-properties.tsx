import { CalendarPlus, ExternalLink, Globe, Hash, History } from "lucide-react";

import { getHostname } from "@/lib/utils/url";

export interface ProjectPropertiesLabels {
  title: string;
  identifier: string;
  website: string;
  updated: string;
  created: string;
}

interface ProjectPropertiesProps {
  labels: ProjectPropertiesLabels;
  identifier?: string | null;
  websiteUrl?: string | null;
  updatedAt: string;
  createdAt: string;
}

/**
 * The project's Properties rail, drawn like the task one: an icon slot, the
 * value, and a quiet qualifier on the right (as the task's "Owner" row has).
 *
 * The qualifier is the `<dt>`. It comes first in the DOM, so a screen reader
 * reads "Website, sokosumi.com", and `order-last` moves it to the right edge.
 */
export function ProjectProperties({
  labels,
  identifier,
  websiteUrl,
  updatedAt,
  createdAt,
}: ProjectPropertiesProps) {
  const websiteHostname = websiteUrl ? getHostname(websiteUrl) : null;

  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-medium">
        {labels.title}
      </h2>
      <dl className="space-y-1">
        {identifier ? (
          <PropertyRow
            icon={<Hash className="text-muted-foreground size-4" />}
            label={labels.identifier}
          >
            <span className="truncate font-mono uppercase">{identifier}</span>
          </PropertyRow>
        ) : null}

        {websiteUrl && websiteHostname ? (
          <PropertyRow
            icon={<Globe className="text-muted-foreground size-4" />}
            label={labels.website}
          >
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={websiteUrl}
              className="hover:text-primary inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
            >
              <span className="truncate">{websiteHostname}</span>
              <ExternalLink
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            </a>
          </PropertyRow>
        ) : null}

        <PropertyRow
          icon={<History className="text-muted-foreground size-4" />}
          label={labels.updated}
        >
          <span className="truncate tabular-nums">{updatedAt}</span>
        </PropertyRow>

        <PropertyRow
          icon={<CalendarPlus className="text-muted-foreground size-4" />}
          label={labels.created}
        >
          <span className="truncate tabular-nums">{createdAt}</span>
        </PropertyRow>
      </dl>
    </section>
  );
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  /** Sits in a fixed slot so every row's text starts at the same x. */
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-8 min-w-0 items-center gap-2 text-sm">
      <dt className="text-muted-foreground order-last ms-auto shrink-0 ps-3 text-xs">
        {label}
      </dt>
      {/* The icon lives inside the <dd>: a row in a <dl> may hold only its
          <dt> and <dd>. */}
      <dd className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center"
        >
          {icon}
        </span>
        {children}
      </dd>
    </div>
  );
}
