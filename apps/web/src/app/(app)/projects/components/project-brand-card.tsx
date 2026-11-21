"use client";

import type { ProjectDesignMd } from "@sokosumi/core-client";
import { normalizeWebsiteUrl } from "@sokosumi/utils";
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
import { useFormatter, useTranslations } from "next-intl";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  type FailedProjectBrandGeneration,
  hasProjectBrandAttemptInFlight,
  hasProjectBrandAutoStartAttempted,
  markProjectBrandAutoStartAttempted,
  onProjectBrandStorageChange,
  projectBrandJobCallbacks,
  projectBrandWebsite,
  readFailedProjectBrandGeneration,
  readPendingProjectBrandJob,
} from "@/app/projects/project-brand-job";
import { DesignMdUploadTrigger } from "@/components/design-md/design-md-upload-trigger";
import { DESIGN_MD_TRANSLATION_NAMESPACE } from "@/components/design-md/types";
import { useDesignMdGeneration } from "@/components/design-md/use-design-md-generation";
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
import { Input } from "@/components/ui/input";
import {
  removeProjectDesignMd,
  updateProject,
} from "@/lib/actions/project/action";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

interface ProjectBrandProviderProps {
  autoStart?: boolean;
  children: ReactNode;
  initialDesignMd: ProjectDesignMd | null;
  projectId: string;
  websiteUrl?: string | null;
}

/** `live`: it failed while this page was open, so it is announced. */
type BrandFailure = FailedProjectBrandGeneration & { live?: boolean };

interface ProjectBrandDashboardValue {
  designMd: ProjectDesignMd | null;
  /** The latest failed generation, until a new attempt starts. */
  failure: BrandFailure | null;
  generation: ReturnType<typeof useDesignMdGeneration>;
  setDesignMd: (designMd: ProjectDesignMd | null) => void;
}

interface ProjectBrandCardProps {
  projectId: string;
  websiteUrl?: string | null;
  /** A CMO Project: CMO writes its DESIGN.md, so the card only opens it. */
  readOnly?: boolean;
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
  autoStart = true,
  children,
  initialDesignMd,
  projectId,
  websiteUrl,
}: ProjectBrandProviderProps) {
  const tDesignMd = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const [designMd, setDesignMd] = useState<ProjectDesignMd | null>(
    initialDesignMd,
  );
  const viewerId = useSession().data?.user.id;
  const [failure, setFailure] = useState<BrandFailure | null>(null);
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
    },
    [],
  );
  const generation = useDesignMdGeneration({
    messages,
    onCompleted: handleCompleted,
    // The job's own URL: a website just saved in the card is not in the
    // props yet when its generation starts.
    ...projectBrandJobCallbacks(projectId, viewerId, (nextFailure) =>
      setFailure(nextFailure && { ...nextFailure, live: true }),
    ),
    owner,
  });

  // Bumped when another surface in this tab writes the project's brand
  // state, such as a wizard that closed before its job or failure came back.
  const [storageVersion, bumpStorageVersion] = useReducer(
    (version: number) => version + 1,
    0,
  );
  useEffect(
    () => onProjectBrandStorageChange(projectId, bumpStorageVersion),
    [projectId],
  );

  // Browser storage exists only after hydration and the viewer once the
  // session loads, so a remembered failure comes in after the first render.
  // The failure this page just saw keeps its `live` flag, and stays when
  // storage could not keep it; a retry here clears it.
  useEffect(() => {
    const stored = viewerId
      ? readFailedProjectBrandGeneration(projectId, viewerId)
      : null;
    setFailure((current) =>
      current?.live && (!stored || current.failedAt === stored.failedAt)
        ? current
        : stored,
    );
  }, [projectId, storageVersion, viewerId]);

  // Background brand setup: the wizard may have closed mid-generation, so pick
  // up its pending job here; if there is none but the project has a website
  // and no DESIGN.md yet, kick generation off once so it lands on its own.
  const { resume, generate, isRunning } = generation;
  useEffect(() => {
    if (designMd) {
      // Prevent an explicit remove from immediately recreating a brand when
      // a server re-render remounts this provider in the same browser session.
      backgroundGenerationAttempted.current = true;
      markProjectBrandAutoStartAttempted(projectId);
      return;
    }
    if (isRunning) return;
    // Wait for the viewer, so a failure this attempt meets is kept.
    if (!viewerId) return;
    const pending = readPendingProjectBrandJob(projectId);
    if (pending) {
      if (backgroundGenerationAttempted.current) return;
      backgroundGenerationAttempted.current = true;
      resume(pending);
      return;
    }
    if (!autoStart || !websiteUrl) return;
    if (backgroundGenerationAttempted.current) return;
    if (hasProjectBrandAutoStartAttempted(projectId)) return;
    // A start elsewhere (the wizard's) hands its job over when it answers.
    if (hasProjectBrandAttemptInFlight(projectId)) return;
    // A failure on this website (the wizard's too) waits for the owner, not
    // a silent retry. One on an older website does not count.
    if (
      readFailedProjectBrandGeneration(projectId, viewerId)?.website ===
      projectBrandWebsite(websiteUrl)
    ) {
      return;
    }
    backgroundGenerationAttempted.current = true;
    markProjectBrandAutoStartAttempted(projectId);
    void generate({ url: websiteUrl });
  }, [
    autoStart,
    designMd,
    generate,
    isRunning,
    projectId,
    resume,
    storageVersion,
    viewerId,
    websiteUrl,
  ]);

  const value = useMemo(
    () => ({ designMd, failure, generation, setDesignMd }),
    [designMd, failure, generation],
  );

  return (
    <ProjectBrandDashboardContext value={value}>
      {children}
    </ProjectBrandDashboardContext>
  );
}

export function ProjectBrandCard({
  projectId,
  websiteUrl,
  readOnly = false,
}: ProjectBrandCardProps) {
  const t = useTranslations("App.Projects.Detail");
  const { designMd, failure, generation, setDesignMd } =
    useProjectBrandDashboard();
  const format = useFormatter();
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, startRemoveTransition] = useTransition();
  const owner = useMemo(
    () => ({ type: "project" as const, projectId }),
    [projectId],
  );
  const hasWebsite = Boolean(websiteUrl);
  const tWebsite = useTranslations("App.Projects.Wizard.name");
  // Shows the saved website until someone types, so a website generation
  // could not use can be corrected right here instead of in Edit. Without a
  // draft the field follows the prop, so a refresh never leaves a stale URL.
  const [websiteDraft, setWebsiteDraft] = useState<string | null>(null);
  const website = websiteDraft ?? websiteUrl ?? "";
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [isSavingWebsite, startSaveWebsite] = useTransition();
  const menuBusy =
    generation.isRunning || isRemoving || isUploading || isSavingWebsite;
  // The card's form explains a failure, so read-only cards keep the plain
  // message. A failure on another website than the saved one no longer
  // applies.
  const shownFailure =
    failure &&
    !readOnly &&
    !designMd &&
    !generation.isRunning &&
    websiteUrl &&
    failure.website === projectBrandWebsite(websiteUrl)
      ? { ...failure, host: new URL(failure.website).host }
      : null;
  const websiteDescription =
    [
      websiteError ? "project-brand-website-error" : null,
      shownFailure ? "project-brand-failure" : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  function handleGenerate() {
    if (!websiteUrl) return;
    void generation.generate({ force: true, url: websiteUrl });
  }

  // An explicit Generate: save only the website (a name from this render
  // could undo someone's rename), then start generation here. Marking the
  // auto-start as used keeps the provider from starting a second one when
  // the revalidated page passes the website in. The saved website unchanged
  // is a plain retry.
  function handleSaveWebsite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = normalizeWebsiteUrl(website);
    if (!url) {
      setWebsiteError(t("brandCard.websiteInvalid"));
      return;
    }
    setWebsiteError(null);
    if (websiteUrl && url === normalizeWebsiteUrl(websiteUrl)) {
      setWebsiteDraft(null);
      handleGenerate();
      return;
    }
    startSaveWebsite(async () => {
      try {
        const result = await updateProject({ projectId, websiteUrl: url });
        if (!result.ok) {
          setWebsiteError(t("errors.update"));
          return;
        }
        // Saved: the prop is the truth again, so a later refresh wins. A
        // failed save keeps the draft for another try.
        setWebsiteDraft(null);
        markProjectBrandAutoStartAttempted(projectId);
        void generation.generate({ force: true, url });
      } catch {
        setWebsiteError(t("errors.update"));
      }
    });
  }

  function handleRemove() {
    startRemoveTransition(async () => {
      try {
        await removeProjectDesignMd({ projectId });
        setDesignMd(null);
        setIsRemoveDialogOpen(false);
        setShowUpload(false);
        toast.success(t("brandCard.removed"));
      } catch {
        toast.error(t("errors.brand"));
      }
    });
  }

  return (
    <>
      <section
        id="project-brand-card"
        className="scroll-mt-4 self-start space-y-2"
        data-testid="project-brand-card"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-muted-foreground text-xs font-medium">
            {t("brand")}
          </h2>
          {/* Without a DESIGN.md the actions are buttons below, not a menu. */}
          {designMd ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  // Negative margin: the 32px button must not make this row
                  // taller than its heading, or the heading sits lower than
                  // every other section heading on the page.
                  className="hit-area -my-2 size-8"
                  aria-label={t("brandCard.moreActions")}
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {readOnly ? null : (
                  <DropdownMenuItem
                    disabled={!hasWebsite || menuBusy}
                    onSelect={() => {
                      handleGenerate();
                    }}
                  >
                    {generation.isRunning ? (
                      <Loader2
                        className="size-4 animate-spin motion-reduce:animate-pulse"
                        aria-hidden
                      />
                    ) : (
                      <RefreshCw className="size-4" aria-hidden />
                    )}
                    {t("brandCard.generate")}
                  </DropdownMenuItem>
                )}
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
                {readOnly ? null : (
                  <>
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
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* The project's name and mark are already in the page header. */}
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <FileText
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <span className="truncate">DESIGN.md</span>
          </p>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 gap-1.5 text-xs",
              shownFailure && "text-destructive border-destructive",
            )}
          >
            {generation.isRunning ? (
              <Loader2
                className="size-3 animate-spin motion-reduce:animate-pulse"
                aria-hidden
              />
            ) : designMd ? (
              <span
                className="bg-semantic-success size-1.5 rounded-full"
                aria-hidden
              />
            ) : shownFailure ? (
              <span
                className="bg-semantic-destructive size-1.5 rounded-full"
                aria-hidden
              />
            ) : null}
            {generation.isRunning
              ? t("brandCard.generating")
              : designMd
                ? t("brandCard.ready")
                : shownFailure
                  ? t("brandCard.failed")
                  : t("brandCard.notSet")}
          </Badge>
        </div>

        {!readOnly && !designMd && !generation.isRunning ? (
          <form noValidate onSubmit={handleSaveWebsite} className="space-y-2">
            <label
              htmlFor="project-brand-website"
              className="text-muted-foreground block text-xs"
            >
              {hasWebsite
                ? t("brandCard.websiteLabel")
                : t("brandCard.missingWebsite")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="project-brand-website"
                inputMode="url"
                autoComplete="url"
                placeholder={tWebsite("websitePlaceholder")}
                value={website}
                onChange={(event) => {
                  setWebsiteDraft(event.target.value);
                  setWebsiteError(null);
                }}
                disabled={isSavingWebsite}
                // Marked while the field holds the website that failed.
                aria-invalid={
                  Boolean(websiteError) ||
                  shownFailure?.website === projectBrandWebsite(website)
                }
                aria-describedby={websiteDescription}
                className="min-w-0 sm:h-8 sm:flex-1"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                loading={isSavingWebsite}
                disabled={menuBusy}
                className="h-10 sm:h-8"
              >
                <RefreshCw aria-hidden />
                {t("brandCard.generate")}
              </Button>
            </div>
            {websiteError ? (
              <p
                id="project-brand-website-error"
                className="text-destructive text-xs"
                role="alert"
              >
                {websiteError}
              </p>
            ) : null}
            {shownFailure ? (
              <div id="project-brand-failure" className="space-y-1 text-xs">
                <p
                  className="text-destructive"
                  // Announced when it happens, not again on every visit.
                  role={shownFailure.live ? "alert" : undefined}
                >
                  {t("brandCard.failedReason", { host: shownFailure.host })}
                </p>
                <p className="text-muted-foreground">
                  {t("brandCard.lastTried", {
                    when: format.dateTime(
                      new Date(shownFailure.failedAt),
                      "dateTimeMedium",
                    ),
                  })}
                </p>
              </div>
            ) : null}
          </form>
        ) : !hasWebsite && !readOnly ? (
          <p className="text-muted-foreground text-xs">
            {t("brandCard.missingWebsite")}
          </p>
        ) : null}
        {generation.errorMessage && !shownFailure ? (
          <p className="text-destructive text-xs" role="alert">
            {generation.errorMessage}
          </p>
        ) : null}

        {!readOnly && !designMd && !generation.isRunning && !showUpload ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={menuBusy}
              onClick={() => setShowUpload(true)}
            >
              <Upload aria-hidden />
              {t("brandCard.upload")}
            </Button>
          </div>
        ) : null}

        {!readOnly && !designMd && showUpload ? (
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
              {t("brandCard.removeDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-semantic-destructive-solid text-semantic-destructive-foreground hover:bg-destructive-hover"
              loading={isRemoving}
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
