import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { getHostname } from "@/lib/utils/url";

interface ProjectDetailHeaderMetadataItem {
  label: string;
  value: string;
}

interface ProjectDetailHeaderProps {
  projectName: string;
  projectLogo?: string | null;
  websiteUrl?: string | null;
  backLabel: string;
  metadata: ProjectDetailHeaderMetadataItem[];
  actions?: React.ReactNode;
}

export function ProjectDetailHeader({
  projectName,
  projectLogo,
  websiteUrl,
  backLabel,
  metadata,
  actions,
}: ProjectDetailHeaderProps) {
  const websiteHostname = websiteUrl ? getHostname(websiteUrl) : null;

  return (
    <div className="space-y-4">
      <Link
        href="/projects"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" aria-hidden />
        <span>{backLabel}</span>
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ProjectAvatar
            name={projectName}
            logo={projectLogo}
            className="size-10 rounded-lg text-sm"
          />
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-xl leading-tight font-semibold tracking-tight">
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

            <dl className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums">
              {metadata.map((item, index) => (
                <div key={item.label} className="flex items-center gap-2">
                  {index > 0 ? <span aria-hidden>·</span> : null}
                  <div className="flex items-center gap-1.5">
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="shrink-0">{actions}</div>
      </div>
    </div>
  );
}
