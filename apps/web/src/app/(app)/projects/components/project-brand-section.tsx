"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { DesignMdProfileSection } from "@/components/design-md";
import { removeProjectDesignMd } from "@/lib/actions/project/action";
import type { ProjectDesignMd } from "@/lib/clients/generated/core/types.gen";

interface ProjectBrandSectionProps {
  projectId: string;
  projectName: string;
  logo?: string | null;
  websiteUrl?: string | null;
  designMd: ProjectDesignMd | null;
}

export function ProjectBrandSection({
  projectId,
  projectName,
  logo,
  websiteUrl,
  designMd,
}: ProjectBrandSectionProps) {
  const router = useRouter();
  const t = useTranslations("App.Projects.Detail");

  return (
    <section className="space-y-3" data-testid="project-brand-section">
      <div className="flex items-center gap-2.5">
        <ProjectAvatar name={projectName} logo={logo} />
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {t("brand")}
        </h2>
      </div>
      <DesignMdProfileSection
        canManage
        className="shadow-none"
        editHref={`/projects/${projectId}/design-md/edit`}
        owner={{ type: "project", projectId }}
        value={
          designMd
            ? {
                url: designMd.url,
                extractionId: designMd.extractionId,
              }
            : undefined
        }
        websiteUrl={websiteUrl}
        onValueChange={async (value) => {
          if (!value) {
            await removeProjectDesignMd({ projectId });
          }
          router.refresh();
        }}
      />
    </section>
  );
}
