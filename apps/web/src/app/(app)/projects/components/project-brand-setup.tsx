"use client";

import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { projectBrandJobCallbacks } from "@/app/projects/project-brand-job";
import {
  DESIGN_MD_TRANSLATION_NAMESPACE,
  type DesignMdOwner,
} from "@/components/design-md/types";
import { useDesignMdGeneration } from "@/components/design-md/use-design-md-generation";
import { useProjectBrandDesignMdStart } from "@/hooks/effects/use-project-brand-design-md-start";
import { useProjectBrandIconLookup } from "@/hooks/effects/use-project-brand-icon-lookup";
import { useSession } from "@/lib/auth/auth.client";

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

export function ProjectBrandSetup(props: ProjectBrandSetupProps) {
  const { projectId, projectName, websiteUrl, onReadyLogo, onBrandChange } =
    props;
  const t = useTranslations("App.Projects.Wizard.brand");
  const viewerId = useSession().data?.user.id;
  const { logoUrl, isResolvingLogo } = useProjectBrandIconLookup({
    projectId,
    projectName,
    websiteUrl,
    logoFailedMessage: t("logoFailed"),
    onReadyLogo,
    onBrandChange,
  });

  // DESIGN.md setup starts once the viewer is known, so a failure is kept for
  // the project page: it mounts again when the session loads.
  return (
    <BrandSetup
      key={viewerId ?? ""}
      {...props}
      isResolvingLogo={isResolvingLogo}
      logoUrl={logoUrl}
      viewerId={viewerId}
    />
  );
}

function BrandSetup({
  projectId,
  projectName,
  websiteUrl,
  onBrandChange,
  isResolvingLogo,
  logoUrl,
  viewerId,
}: ProjectBrandSetupProps & {
  isResolvingLogo: boolean;
  logoUrl: string | null;
  viewerId: string | undefined;
}) {
  const t = useTranslations("App.Projects.Wizard.brand");
  const tDesignMd = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);

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
    // A failure seen here is kept too, so the project page shows it.
    ...projectBrandJobCallbacks(projectId, viewerId),
    owner,
  });

  useProjectBrandDesignMdStart(viewerId, websiteUrl, brand.generate);

  const isBusy = isResolvingLogo || brand.isRunning || brand.status === "idle";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
      <div className="flex min-h-24 items-center justify-center">
        {isResolvingLogo ? (
          <div className="bg-muted flex size-24 items-center justify-center rounded-lg border">
            <Loader2 className="text-muted-foreground size-6 animate-spin motion-reduce:animate-pulse" />
          </div>
        ) : brand.status === "completed" && !isResolvingLogo ? (
          <div className="relative">
            <ProjectAvatar
              name={projectName}
              logo={logoUrl}
              className="size-24 rounded-lg text-2xl"
            />
            <span className="bg-muted border-border absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-md border">
              <Check className="text-foreground size-3.5" />
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

      <h2 className="mt-8 text-2xl leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
        {t("title")}
      </h2>
      <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-base leading-[1.6] text-balance">
        {isBusy
          ? t("fetching")
          : brand.status === "failed"
            ? t("failed")
            : t("ready")}
      </p>
    </div>
  );
}
