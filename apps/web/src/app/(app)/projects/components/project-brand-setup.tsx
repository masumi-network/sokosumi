"use client";

import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import {
  clearPendingProjectBrandJob,
  savePendingProjectBrandJob,
} from "@/app/projects/project-brand-job";
import {
  DESIGN_MD_TRANSLATION_NAMESPACE,
  type DesignMdOwner,
  useDesignMdGeneration,
} from "@/components/design-md";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  resolveProjectSiteIcon,
  updateProject,
} from "@/lib/actions/project/action";

export interface ProjectBrandChange {
  logo?: string | null;
  designMd?: {
    url: string;
    extractionId: string | null;
  } | null;
}

interface ProjectBrandSetupProps {
  projectId: string;
  projectName: string;
  websiteUrl: string;
  onReadyLogo?: (logoUrl: string | null) => void;
  onBrandChange?: (brand: ProjectBrandChange) => void;
}

export function ProjectBrandSetup({
  projectId,
  projectName,
  websiteUrl,
  onReadyLogo,
  onBrandChange,
}: ProjectBrandSetupProps) {
  const t = useTranslations("App.Projects.Wizard.brand");
  const tDesignMd = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isResolvingLogo, setIsResolvingLogo] = useState(true);

  const owner = useMemo<DesignMdOwner>(
    () => ({ type: "project", projectId }),
    [projectId],
  );

  const brand = useDesignMdGeneration({
    messages: {
      generationFailed: tDesignMd("generateError"),
      saveFailed: tDesignMd("saveError"),
      startFailed: tDesignMd("startGenerateError"),
    },
    onCompleted: (designMd) => {
      onBrandChange?.({
        designMd: {
          url: designMd.url,
          extractionId: designMd.extractionId,
        },
      });
    },
    // The wizard may close before the job finishes; the project page resumes
    // polling from this record so the brand still lands in the background.
    onJobStarted: (job) =>
      savePendingProjectBrandJob(projectId, { ...job, url: websiteUrl }),
    onSettled: () => clearPendingProjectBrandJob(projectId),
    owner,
  });

  useMountEffect(() => {
    void (async () => {
      try {
        const result = await resolveProjectSiteIcon({
          url: websiteUrl,
          projectId,
        });
        const nextLogo = result.ok ? (result.value.url ?? null) : null;
        setLogoUrl(nextLogo);
        onReadyLogo?.(nextLogo);
        onBrandChange?.({ logo: nextLogo });
        if (nextLogo) {
          await updateProject({
            projectId,
            name: projectName,
            logo: nextLogo,
          });
        }
      } catch (error) {
        console.error("Failed to resolve project logo", error);
        toast.error(t("logoFailed"));
      } finally {
        setIsResolvingLogo(false);
      }
    })();

    void brand.generate({ url: websiteUrl });
  });

  const isBusy = isResolvingLogo || brand.isRunning;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
      <div className="flex min-h-24 items-center justify-center">
        {isResolvingLogo ? (
          <div className="bg-muted flex size-24 items-center justify-center rounded-lg border">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : brand.status === "completed" && !isResolvingLogo ? (
          <div className="relative">
            <ProjectAvatar
              name={projectName}
              logo={logoUrl}
              className="size-24 rounded-lg text-2xl"
            />
            <span className="bg-primary/10 border-primary/20 absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-md border">
              <Check className="text-primary size-3.5" />
            </span>
          </div>
        ) : (
          <ProjectAvatar
            name={projectName}
            logo={logoUrl}
            className="size-24 rounded-lg text-2xl"
          />
        )}
      </div>

      <h2 className="mt-8 text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
        {t("title")}
      </h2>
      <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-balance">
        {isBusy
          ? t("fetching")
          : brand.status === "failed"
            ? t("failed")
            : t("ready")}
      </p>
    </div>
  );
}
