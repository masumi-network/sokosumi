"use client";

import type { ProjectDesignMd } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS, normalizeWebsiteUrl } from "@sokosumi/utils";
import {
  Building2,
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
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  type FailedProjectBrandGeneration,
  getProjectBrandStorageVersion,
  markProjectBrandAutoStartAttempted,
  onProjectBrandStorageChange,
  parseFailedProjectBrandGeneration,
  projectBrandJobCallbacks,
  projectBrandWebsite,
  readFailedProjectBrandGenerationJson,
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
import { useProjectBrandAutoSetup } from "@/hooks/effects/use-project-brand-auto-setup";
import { copyOrganizationDesignMdToProject } from "@/lib/actions/design-md/action";
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
  /** A page's own action on the whole brand, shown beside the menu once a DESIGN.md exists. */
  headerAction?: ReactNode;
  /** The active organization's name when it has a DESIGN.md to copy. */
  organizationName?: string | null;
}

/**
 * The project whose brand menu should take focus when it shows: set by a
 * keyboard copy, whose button leaves with the empty form. Module scope, not
 * component state, because the action's revalidation remounts the card (the
 * page keys it by the file) and the menu must take focus again then. Cleared
 * once focus moves on to another control, and good for a few seconds only, so
 * a later visit never has its focus taken.
 */
let brandMenuFocus: { projectId: string; until: number } | null = null;
const BRAND_MENU_FOCUS_MS = 10_000;

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
  const [liveFailure, setLiveFailure] = useState<BrandFailure | null>(null);
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
      setLiveFailure(nextFailure && { ...nextFailure, live: true }),
    ),
    owner,
  });

  // Bumped when another surface in this tab writes the project's brand
  // state, such as a wizard that closed before its job or failure came back.
  const subscribeToStorage = useCallback(
    (onChange: () => void) => onProjectBrandStorageChange(projectId, onChange),
    [projectId],
  );
  const storageVersion = useSyncExternalStore(
    subscribeToStorage,
    getProjectBrandStorageVersion,
    () => 0,
  );

  // Browser storage exists only after hydration and the viewer once the
  // session loads, so a remembered failure comes in after the first render.
  const storedFailureJson = useSyncExternalStore(
    subscribeToStorage,
    () =>
      viewerId
        ? readFailedProjectBrandGenerationJson(projectId, viewerId)
        : null,
    () => null,
  );
  const storedFailure = useMemo(
    () => parseFailedProjectBrandGeneration(storedFailureJson),
    [storedFailureJson],
  );
  // The failure this page just saw keeps its `live` flag, and stays when
  // storage could not keep it; a retry here clears it. A later failure stored
  // by another surface replaces it for good.
  if (
    liveFailure &&
    storedFailure &&
    liveFailure.failedAt !== storedFailure.failedAt
  ) {
    setLiveFailure(null);
  }
  const failure =
    liveFailure &&
    (!storedFailure || liveFailure.failedAt === storedFailure.failedAt)
      ? liveFailure
      : storedFailure;

  const { resume, generate, isRunning } = generation;
  useProjectBrandAutoSetup({
    autoStart,
    backgroundGenerationAttempted,
    designMd,
    generate,
    isRunning,
    projectId,
    resume,
    storageVersion,
    viewerId,
    websiteUrl,
  });

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
  headerAction,
  organizationName,
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
  const [isCopying, startCopy] = useTransition();
  const focusBrandMenu = useCallback(
    (menuButton: HTMLButtonElement | null) => {
      if (
        menuButton &&
        brandMenuFocus?.projectId === projectId &&
        Date.now() < brandMenuFocus.until
      ) {
        menuButton.focus();
      }
    },
    [projectId],
  );
  const menuBusy =
    generation.isRunning ||
    isRemoving ||
    isUploading ||
    isSavingWebsite ||
    isCopying;
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

  function handleCopyOrganization(organization: string, button: HTMLElement) {
    brandMenuFocus =
      document.activeElement === button
        ? { projectId, until: Date.now() + BRAND_MENU_FOCUS_MS }
        : null;
    startCopy(async () => {
      const result = await copyOrganizationDesignMdToProject({ projectId });
      if (!result.ok) {
        const alreadySet =
          result.error.kind === CORE_API_ERROR_KINDS.PROJECT_DESIGN_MD_EXISTS;
        // Already set: the action refreshed the page, which swaps this form
        // for the saved brand, so a focus request stands for its menu.
        // Otherwise the button stays, and so does focus.
        if (!alreadySet) brandMenuFocus = null;
        toast.error(
          alreadySet
            ? t("brandCard.organizationAlreadySet")
            : t("errors.brand"),
        );
        return;
      }
      setDesignMd({
        extractionId: result.value.extractionId,
        url: result.value.url,
      });
      toast.success(t("brandCard.organizationCopied", { organization }));
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
            // Half the menu button's negative margin: the row grows 4px, so a
            // 32px action keeps a gap above the status badge below it.
            <div className="-my-1 flex items-center gap-2">
              {headerAction}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={focusBrandMenu}
                    onBlur={(event) => {
                      // Removal from the page has no next control; a move
                      // elsewhere does.
                      if (event.relatedTarget) brandMenuFocus = null;
                    }}
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
            </div>
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
            {/* Field, Generate and Upload read as one tool: one row where
                they fit; on a phone the field takes its own row and the
                actions share the next. Long labels wrap a button down
                instead of overflowing. */}
            <div className="flex flex-wrap gap-2">
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
                className="min-w-0 basis-full sm:h-8 sm:min-w-48 sm:flex-1 sm:basis-0"
              />
              <div className="flex grow flex-wrap gap-2 sm:grow-0">
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  loading={isSavingWebsite}
                  disabled={menuBusy}
                  className="h-10 grow sm:h-8"
                >
                  <RefreshCw aria-hidden />
                  {t("brandCard.generate")}
                </Button>
                {!showUpload ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={menuBusy}
                    onClick={() => setShowUpload(true)}
                    // Matches Generate beside it: 40px on a phone, 32px up.
                    className="h-10 grow sm:h-8"
                  >
                    <Upload aria-hidden />
                    {t("brandCard.upload")}
                  </Button>
                ) : null}
              </div>
            </div>
            {/* Its own row, so the website row keeps one layout in every
                workspace, and a long organization name wraps inside the
                card instead of pushing past it. */}
            {organizationName ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={isCopying}
                disabled={menuBusy}
                onClick={(event) =>
                  handleCopyOrganization(organizationName, event.currentTarget)
                }
                onBlur={(event) => {
                  // Moving on while the copy runs cancels the focus request;
                  // the button leaving the page has no next control.
                  if (event.relatedTarget) brandMenuFocus = null;
                }}
                className="h-auto min-h-10 w-full max-w-full whitespace-normal wrap-anywhere py-2 text-start sm:min-h-8 sm:w-auto sm:py-1"
              >
                <Building2 aria-hidden />
                {t("brandCard.useOrganization", {
                  organization: organizationName,
                })}
              </Button>
            ) : null}
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
