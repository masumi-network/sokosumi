import type { LucideIcon } from "lucide-react";
import { CalendarDays, FolderOpen, ImagePlus, Share2 } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

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

/**
 * Column counts, spelled out.
 *
 * Tailwind scans for whole class names, so the count cannot be interpolated.
 * Written out is also the honest list of how many tiles this row can hold.
 */
const COLUMNS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

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
    // No panel around these. #5257 put the tiles on a shared surface because
    // they were loose on the page background; the workspace card is that
    // surface now, and a second one inside it is exactly the nested ornament
    // this page was full of. The gutter does the grouping, and each tile
    // still paints `bg-background` so its hover is a step away from both the
    // tile and the card under it.
    <div className="space-y-3">
      <div
        className={cn(
          "grid grid-cols-2 gap-3",
          COLUMNS[live.length] ?? "md:grid-cols-4",
        )}
      >
        {live.map(({ icon: Icon, key, href }) => (
          <Link
            className="border-border bg-background hover:border-primary-tertiary hover:bg-card-background-hover focus-visible:border-ring focus-visible:ring-ring-halo flex min-w-0 flex-col rounded-lg border p-3 transition-colors outline-none focus-visible:ring-[3px]"
            href={href}
            key={key}
          >
            <Icon className="text-muted-foreground size-4" aria-hidden />
            <h3 className="mt-2.5 text-sm font-medium">{labels[key].title}</h3>
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
