import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { cn } from "@/lib/utils";
import { getHostname } from "@/lib/utils/url";

interface ProjectDetailHeaderMetadataItem {
  label: string;
  value: string;
}

interface ProjectDetailHeaderProps {
  backHref?: string;
  className?: string;
  projectName: string;
  projectLogo?: string | null;
  websiteUrl?: string | null;
  backLabel: string;
  metadata: ProjectDetailHeaderMetadataItem[];
  actions?: React.ReactNode;
}

/**
 * Who this page is about, as the top of the workspace card.
 *
 * One block: the mark, the name, where it points, what has been done to it,
 * and the actions that apply to the whole project. It used to sit loose in
 * the app gutter above an unrelated rule; it is the card's header now, which
 * is why it carries the card's inset rather than spacing of its own.
 */
export function ProjectDetailHeader({
  backHref = "/projects",
  className,
  projectName,
  projectLogo,
  websiteUrl,
  backLabel,
  metadata,
  actions,
}: ProjectDetailHeaderProps) {
  const websiteHostname = websiteUrl ? getHostname(websiteUrl) : null;

  return (
    <div className={cn("pb-4", className)}>
      {/* The sidebar's project scope switcher (and its chip in the app header
          on a phone) is how you change or leave a project now, so a plain
          "back to projects" link here is redundant — `main` stopped drawing
          it. A link to a real parent, like a project sub-page, still earns
          its place, and only below `sm`, where the app header's
          "Projects › …" breadcrumb is hidden. */}
      {backHref !== "/projects" ? (
        <Link
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm transition-colors sm:hidden"
          href={backHref}
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span>{backLabel}</span>
        </Link>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ProjectAvatar
            name={projectName}
            logo={projectLogo}
            className="size-9 rounded-lg text-sm"
          />
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">
                {projectName}
              </h1>
              {websiteUrl && websiteHostname ? (
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1 text-sm transition-colors"
                >
                  <span className="truncate">{websiteHostname}</span>
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
              ) : null}
            </div>

            {/* Spacing separates these, not a bullet. The bullet belonged to
                the item after it, so when the row wrapped on a phone the
                second line opened with a stray "·". */}
            {metadata.length > 0 ? (
              <dl className="text-muted-foreground flex w-full flex-wrap items-center gap-x-4 gap-y-0.5 text-xs tabular-nums">
                {metadata.map((item) => (
                  <div className="flex items-center gap-1.5" key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>

        <div className="shrink-0">{actions}</div>
      </div>
    </div>
  );
}
