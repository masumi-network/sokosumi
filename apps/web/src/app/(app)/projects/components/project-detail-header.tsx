import { ProjectAvatar } from "@/app/projects/components/project-avatar";

interface ProjectDetailHeaderProps {
  projectName: string;
  projectLogo?: string | null;
  actions?: React.ReactNode;
}

/**
 * Who this page is about: the mark, the name and the actions that apply to
 * the whole project, drawn like the task detail header. Facts about the
 * project (website, dates) live in the Properties rail beside it.
 *
 * The name wraps instead of truncating, as a task title does, so a long name
 * is never cut off with no way to read the rest of it.
 */
export function ProjectDetailHeader({
  projectName,
  projectLogo,
  actions,
}: ProjectDetailHeaderProps) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-4">
      {/* The mark is one line box tall and sits on the first line, so a name
          that wraps keeps its mark beside where it starts. */}
      <div className="flex min-w-0 items-start gap-3">
        <ProjectAvatar
          name={projectName}
          logo={projectLogo}
          className="size-7 rounded-md text-xs"
        />
        <h1 className="min-w-0 text-xl leading-7 font-semibold tracking-tight text-balance break-words hyphens-auto">
          {projectName}
        </h1>
      </div>

      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
