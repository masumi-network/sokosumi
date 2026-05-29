import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface ProjectDetailHeaderMetadataItem {
  label: string;
  value: string;
}

interface ProjectDetailHeaderProps {
  projectName: string;
  backLabel: string;
  metadata: ProjectDetailHeaderMetadataItem[];
  actions?: React.ReactNode;
}

export function ProjectDetailHeader({
  projectName,
  backLabel,
  metadata,
  actions,
}: ProjectDetailHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span>{backLabel}</span>
        </Link>

        {actions}
      </div>

      <div className="space-y-3">
        <h1 className="text-xl leading-tight font-semibold tracking-tight">
          {projectName}
        </h1>

        <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {metadata.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <dt>{item.label}</dt>
              <dd className="text-foreground/70">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
