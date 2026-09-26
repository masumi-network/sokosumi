import type { LucideIcon } from "lucide-react";
import { CalendarDays, FolderOpen, ImagePlus, Share2 } from "lucide-react";
import Link from "next/link";

interface ProjectModuleLabel {
  description: string;
  title: string;
}

interface ProjectModuleTilesLabels {
  calendar: ProjectModuleLabel;
  /**
   * The areas that are a promise rather than a page, as one finished
   * sentence.
   *
   * Resolved by the page because it interpolates the list of names, and
   * next-intl returns the message key rather than the message when an ICU
   * argument is missing.
   */
  comingSoon: string;
  fileBrowser: ProjectModuleLabel;
  imageStudio: ProjectModuleLabel;
  socialMedia: ProjectModuleLabel;
}

interface ProjectModuleTilesProps {
  calendarHref?: string;
  labels: ProjectModuleTilesLabels;
  projectId: string;
  socialHref?: string;
}

type ModuleKey = keyof Omit<ProjectModuleTilesLabels, "comingSoon">;

/**
 * The areas a project can actually open, in the order they are offered.
 *
 * Only these get a tile. Six cards that cannot be clicked filled two thirds
 * of the workspace with things the person cannot do, and made the three they
 * *can* do harder to find rather than easier; the rest are named in one line
 * underneath, which says the same thing and takes one line to say it.
 */
const PROJECT_MODULES: {
  href?: (projectId: string) => string;
  icon: LucideIcon;
  key: ModuleKey;
}[] = [
  { icon: CalendarDays, key: "calendar" },
  {
    icon: FolderOpen,
    key: "fileBrowser",
    href: (projectId) => `/drive?view=tasks&projectId=${projectId}`,
  },
  {
    icon: ImagePlus,
    key: "imageStudio",
    href: (projectId) => `/projects/${projectId}/studio`,
  },
  { icon: Share2, key: "socialMedia" },
];

export function ProjectModuleTiles({
  calendarHref,
  labels,
  projectId,
  socialHref,
}: ProjectModuleTilesProps) {
  const live = PROJECT_MODULES.map((module) => ({
    ...module,
    href:
      module.key === "calendar"
        ? calendarHref
        : module.key === "socialMedia"
          ? socialHref
          : module.href?.(projectId),
  })).filter(
    (module): module is (typeof PROJECT_MODULES)[number] & { href: string } =>
      Boolean(module.href),
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {live.map(({ icon: Icon, key, href }) => (
          <Link
            className="border-border hover:border-primary-tertiary hover:bg-card-background focus-visible:border-ring focus-visible:ring-ring-halo flex min-w-0 flex-col rounded-xl border p-4 transition-colors outline-none focus-visible:ring-[3px]"
            href={href}
            key={key}
          >
            <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Icon className="text-muted-foreground size-4" aria-hidden />
            </span>
            <h3 className="mt-3 text-sm font-medium">{labels[key].title}</h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {labels[key].description}
            </p>
          </Link>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">{labels.comingSoon}</p>
    </div>
  );
}
