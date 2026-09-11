"use client";

import {
  ExternalLink,
  FileText,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import {
  clearPendingProjectBrandJob,
  hasProjectBrandAutoStartAttempted,
  markProjectBrandAutoStartAttempted,
  readPendingProjectBrandJob,
  savePendingProjectBrandJob,
} from "@/app/projects/project-brand-job";
import {
  DESIGN_MD_TRANSLATION_NAMESPACE,
  DesignMdUploadTrigger,
  useDesignMdGeneration,
} from "@/components/design-md";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { removeProjectDesignMd } from "@/lib/actions/project/action";
import type { ProjectDesignMd } from "@/lib/clients/generated/core/types.gen";

interface ProjectBrandProviderProps {
  children: ReactNode;
  initialDesignMd: ProjectDesignMd | null;
  projectId: string;
  websiteUrl?: string | null;
}

interface ProjectBrandDashboardValue {
  designMd: ProjectDesignMd | null;
  generation: ReturnType<typeof useDesignMdGeneration>;
  setDesignMd: (designMd: ProjectDesignMd | null) => void;
}

interface ProjectBrandCardProps {
  logo?: string | null;
  projectId: string;
  projectName: string;
  websiteUrl?: string | null;
}

const ProjectBrandDashboardContext =
  createContext<ProjectBrandDashboardValue | null>(null);

function useProjectBrandDashboard(): ProjectBrandDashboardValue {
  const value = useContext(ProjectBrandDashboardContext);
  if (!value) {
    throw new Error("Project brand dashboard requires ProjectBrandProvider");
  }
  return value;
}

export function ProjectBrandProvider({
  children,
  initialDesignMd,
  projectId,
  websiteUrl,
}: ProjectBrandProviderProps) {
  const router = useRouter();
  const tDesignMd = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const [designMd, setDesignMd] = useState<ProjectDesignMd | null>(
    initialDesignMd,
  );
  const backgroundGenerationAttempted = useRef(false);
  const owner = useMemo(
    () => ({ type: "project" as const, projectId }),
    [projectId],
  );
  const messages = useMemo(
    () => ({
      generationFailed: tDesignMd("generateError"),
      saveFailed: tDesignMd("saveError"),
      startFailed: tDesignMd("startGenerateError"),
    }),
    [tDesignMd],
  );
  const handleCompleted = useCallback(
    (nextDesignMd: { extractionId: string | null; url: string }) => {
      setDesignMd({
        extractionId: nextDesignMd.extractionId,
        url: nextDesignMd.url,
      });
      router.refresh();
    },
    [router],
  );
  const generation = useDesignMdGeneration({
    messages,
    onCompleted: handleCompleted,
    onJobStarted: (job) =>
      websiteUrl
        ? savePendingProjectBrandJob(projectId, { ...job, url: websiteUrl })
        : undefined,
    onSettled: () => clearPendingProjectBrandJob(projectId),
    owner,
  });

  // Background brand setup: the wizard may have closed mid-generation, so pick
  // up its pending job here; if there is none but the project has a website
  // and no DESIGN.md yet, kick generation off once so it lands on its own.
  const { resume, generate, isRunning } = generation;
  useEffect(() => {
    if (designMd) {
      // Prevent an explicit remove from immediately recreating a brand when
      // router.refresh remounts this provider in the same browser session.
      backgroundGenerationAttempted.current = true;
      markProjectBrandAutoStartAttempted(projectId);
      return;
    }
    if (isRunning) return;
    const pending = readPendingProjectBrandJob(projectId);
    if (pending) {
      if (backgroundGenerationAttempted.current) return;
      backgroundGenerationAttempted.current = true;
      resume(pending);
      return;
    }
    if (!websiteUrl) return;
    if (backgroundGenerationAttempted.current) return;
    if (hasProjectBrandAutoStartAttempted(projectId)) return;
    backgroundGenerationAttempted.current = true;
    markProjectBrandAutoStartAttempted(projectId);
    void generate({ url: websiteUrl });
  }, [designMd, generate, isRunning, projectId, resume, websiteUrl]);

  const value = useMemo(
    () => ({ designMd, generation, setDesignMd }),
    [designMd, generation],
  );

  return (
    <ProjectBrandDashboardContext value={value}>
      {children}
    </ProjectBrandDashboardContext>
  );
}

export function ProjectBrandCard({
  logo,
  projectId,
  projectName,
  websiteUrl,
}: ProjectBrandCardProps) {
  const router = useRouter();
  const t = useTranslations("App.Projects.Detail");
  const { designMd, generation, setDesignMd } = useProjectBrandDashboard();
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, startRemoveTransition] = useTransition();
  const owner = useMemo(
    () => ({ type: "project" as const, projectId }),
    [projectId],
  );
  const hasWebsite = Boolean(websiteUrl);
  const menuBusy = generation.isRunning || isRemoving || isUploading;

  function handleGenerate() {
    if (!websiteUrl) return;
    void generation.generate({ force: true, url: websiteUrl });
  }

  function handleRemove() {
    startRemoveTransition(async () => {
      try {
        await removeProjectDesignMd({ projectId });
        setDesignMd(null);
        setIsRemoveDialogOpen(false);
        setShowUpload(false);
        toast.success(t("brandCard.removed"));
        router.refresh();
      } catch {
        toast.error(t("errors.brand"));
      }
    });
  }

  return (
    <>
      <section
        id="project-brand-card"
        className="scroll-mt-4 self-start space-y-4"
        data-testid="project-brand-card"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-muted-foreground text-xs font-medium">
            {t("brand")}
          </h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("brandCard.moreActions")}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!hasWebsite || menuBusy}
                onSelect={() => {
                  handleGenerate();
                }}
              >
                {generation.isRunning ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-4" aria-hidden />
                )}
                {t("brandCard.generate")}
              </DropdownMenuItem>
              {designMd ? (
                <>
                  <DropdownMenuItem asChild>
                    <a
                      href={designMd.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-4" aria-hidden />
                      {t("brandCard.open")}
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/projects/${projectId}/design-md/edit`}>
                      <FileText className="size-4" aria-hidden />
                      {t("brandCard.edit")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={menuBusy}
                    onSelect={(event) => {
                      event.preventDefault();
                      setIsRemoveDialogOpen(true);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("brandCard.remove")}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem
                  disabled={menuBusy}
                  onSelect={() => {
                    setShowUpload(true);
                  }}
                >
                  <Upload className="size-4" aria-hidden />
                  {t("brandCard.upload")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ProjectAvatar name={projectName} logo={logo} className="size-10" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{projectName}</p>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                DESIGN.md
              </p>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1.5 text-xs">
            {generation.isRunning ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : designMd ? (
              <span
                className="bg-semantic-success size-1.5 rounded-full"
                aria-hidden
              />
            ) : null}
            {generation.isRunning
              ? t("brandCard.generating")
              : designMd
                ? t("brandCard.ready")
                : t("brandCard.notSet")}
          </Badge>
        </div>

        {!hasWebsite ? (
          <p className="text-muted-foreground text-xs">
            {t("brandCard.missingWebsite")}
          </p>
        ) : null}
        {generation.errorMessage ? (
          <p className="text-destructive text-xs" role="alert">
            {generation.errorMessage}
          </p>
        ) : null}

        {!designMd && showUpload ? (
          <DesignMdUploadTrigger
            owner={owner}
            variant="compact"
            disabled={menuBusy}
            onUploadingChange={setIsUploading}
            onSaved={(uploadedDesignMd) => {
              setDesignMd({
                extractionId: uploadedDesignMd.extractionId,
                url: uploadedDesignMd.url,
              });
              setShowUpload(false);
              router.refresh();
            }}
          />
        ) : null}
      </section>

      <AlertDialog
        open={isRemoveDialogOpen}
        onOpenChange={setIsRemoveDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("brandCard.removeDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("brandCard.removeDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              {t("deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-semantic-destructive-solid text-destructive-foreground hover:bg-destructive-hover"
              disabled={isRemoving}
              onClick={(event) => {
                event.preventDefault();
                handleRemove();
              }}
            >
              {t("brandCard.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
