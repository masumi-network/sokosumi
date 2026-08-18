import type { LucideIcon } from "lucide-react";
import {
  FileText,
  FolderOpen,
  Mail,
  Megaphone,
  Newspaper,
  Search,
  Share2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

interface ProjectModuleLabel {
  description: string;
  title: string;
}

interface ProjectModuleTilesLabels {
  comingSoon: string;
  content: ProjectModuleLabel;
  email: ProjectModuleLabel;
  fileBrowser: ProjectModuleLabel;
  paidAdvertising: ProjectModuleLabel;
  pr: ProjectModuleLabel;
  seo: ProjectModuleLabel;
  socialMedia: ProjectModuleLabel;
}

interface ProjectModuleTilesProps {
  labels: ProjectModuleTilesLabels;
}

interface ProjectModuleDefinition {
  icon: LucideIcon;
  key: keyof Omit<ProjectModuleTilesLabels, "comingSoon">;
}

const PROJECT_MODULES: ProjectModuleDefinition[] = [
  { icon: Search, key: "seo" },
  { icon: Share2, key: "socialMedia" },
  { icon: Mail, key: "email" },
  { icon: Megaphone, key: "paidAdvertising" },
  { icon: FileText, key: "content" },
  { icon: Newspaper, key: "pr" },
  { icon: FolderOpen, key: "fileBrowser" },
];

export function ProjectModuleTiles({ labels }: ProjectModuleTilesProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
      {PROJECT_MODULES.map(({ icon: Icon, key }) => {
        const module = labels[key];

        return (
          <div
            key={key}
            aria-disabled="true"
            className="bg-muted/30 border-border/50 min-w-0 cursor-default rounded-xl border p-4 opacity-70"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
                <Icon className="text-muted-foreground size-4" aria-hidden />
              </span>
              <Badge variant="outline" className="shrink-0 text-xs">
                {labels.comingSoon}
              </Badge>
            </div>
            <h3 className="mt-3 text-sm font-medium">{module.title}</h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {module.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}
