"use client";

import type {
  ProjectImageJob,
  ProjectImageStudioTalkingVideoCatalog,
  ProjectSocialConnection,
  ProjectTalkingVideos,
  SocialPostMediaRef,
} from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  creditsPerTalkingVideoCents,
  resolveUserUploadContentType,
  talkingVideoQuotedSeconds,
} from "@sokosumi/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { RadioGroup } from "radix-ui";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSocialProviderAvailability } from "@/contexts/social-provider-availability-context";
import {
  prepareStudioAssetSocialMedia,
  startTalkingVideo,
  writeTalkingVideoScripts,
} from "@/lib/actions/image-studio/action";
import { authClient } from "@/lib/auth/auth.client";
import { coreClient } from "@/lib/clients/core.browser.client";
import { writeSocialComposePrefill } from "@/lib/social-compose-prefill";
import { cn } from "@/lib/utils";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";

import { TikTokStudioLibrary } from "./tiktok-studio-library";
import {
  ACTIVE_STATUSES,
  StageJob,
  StagePreview,
  type TalkingVideoAsset,
} from "./tiktok-studio-stage";

const TikTokComposer = dynamic(() =>
  import(
    "@/app/projects/components/social-posts/social-post-composer-dialog"
  ).then((module) => module.SocialPostComposerDialog),
);

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_MIB = 12;
const POLL_MS = 4_000;
/** Languages the voices speak well; the reader's own comes first. */
const SCRIPT_LANGUAGES = ["en", "de", "es", "fr", "it", "pt", "nl"] as const;
const OWN_PHOTO = "own-photo";

type Script = { hook: string; script: string };

/** Something that went wrong, shown beside the step it belongs to. */
type Problem = {
  step: "presenter" | "script" | "make";
  message: string;
} | null;

async function fetchTalkingVideos(
  projectId: string,
): Promise<ProjectTalkingVideos> {
  const response = await fetch(
    `/api/projects/${projectId}/image-studio/talking-videos`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error("Talking videos unavailable");
  return (await response.json()) as ProjectTalkingVideos;
}

/** One thing a video can have besides its presenter. */
function Extra({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        checked={checked}
        className="mt-0.5"
        id={id}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label className="text-sm leading-normal font-normal" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}

export function TikTokStudio({
  projectId,
  hasWebsite,
  catalog,
  initialVideos,
  readOnly,
}: {
  projectId: string;
  /** The Project has a website a video can show. */
  hasWebsite: boolean;
  catalog: ProjectImageStudioTalkingVideoCatalog;
  initialVideos: ProjectTalkingVideos;
  /** A CMO Project is changed in CMO only. */
  readOnly: boolean;
}) {
  const t = useTranslations("App.TikTokStudio");
  const tStudio = useTranslations("App.Studio");
  const locale = useLocale();
  const router = useRouter();
  const scriptId = useId();
  const voiceId = useId();
  const languageId = useId();
  const consentId = useId();
  const showSiteId = useId();
  const musicId = useId();
  const brollId = useId();
  const makeHintId = useId();
  const queryClient = useQueryClient();
  const queryKey = ["talking-videos", projectId];

  const [script, setScript] = useState("");
  const [presenterId, setPresenterId] = useState(
    catalog.presenters[0]?.id ?? OWN_PHOTO,
  );
  const [photo, setPhoto] = useState<{
    id: string;
    name: string;
    /** A local preview of the file just uploaded. */
    previewUrl: string;
  } | null>(null);
  const [consent, setConsent] = useState(false);
  const [showSite, setShowSite] = useState(true);
  const siteShots = hasWebsite && showSite;
  const [music, setMusic] = useState(false);
  const [broll, setBroll] = useState(false);
  const [voice, setVoice] = useState(
    catalog.presenters[0]?.voice ?? catalog.defaultVoice,
  );
  const [languageCode, setLanguageCode] = useState<string>(
    SCRIPT_LANGUAGES.find((code) => locale.startsWith(code)) ?? "en",
  );
  const [suggestions, setSuggestions] = useState<Script[]>([]);
  const [problem, setProblem] = useState<Problem>(null);
  const [uploading, setUploading] = useState(false);
  const [writing, startWriting] = useTransition();
  const [starting, startStarting] = useTransition();
  const { isProviderEnabled } = useSocialProviderAvailability();
  const tikTokEnabled = isProviderEnabled("tiktok");
  const [composeVideo, setComposeVideo] = useState<{
    media: SocialPostMediaRef;
    accounts: ProjectSocialConnection[];
  } | null>(null);
  const [posting, startPosting] = useTransition();
  /** The video on the stage; none shows the preview of the one being set up. */
  const [stageJobId, setStageJobId] = useState<string | null>(
    () =>
      initialVideos.jobs.find((job) => ACTIVE_STATUSES.has(job.status))?.id ??
      null,
  );
  const photoInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLElement>(null);

  const { data: videos } = useQuery({
    queryKey,
    queryFn: () => fetchTalkingVideos(projectId),
    initialData: initialVideos,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => ACTIVE_STATUSES.has(job.status))
        ? POLL_MS
        : false,
  });

  const model =
    catalog.models.find(
      (candidate) => candidate.id === catalog.defaultModelId,
    ) ?? catalog.models[0];
  const trimmed = script.trim();
  const ownPhoto = presenterId === OWN_PHOTO;
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });
  const presenterImage = (id: string | null | undefined) =>
    catalog.presenters.find((presenter) => presenter.id === id)?.imageUrl;
  const assetFor = (job: ProjectImageJob): TalkingVideoAsset | null =>
    videos.assets.find((asset) => asset.jobId === job.id) ?? null;
  const stageJob = videos.jobs.find((job) => job.id === stageJobId) ?? null;

  /** What still stands between the person and the button, if anything. */
  const missing =
    trimmed.length < catalog.scriptMinLength
      ? t("needScript", { count: catalog.scriptMinLength })
      : ownPhoto && !photo
        ? t("photoMissing")
        : ownPhoto && !consent
          ? t("consentMissing")
          : null;

  /** A change to the video being set up brings its preview back. */
  function edit(change: () => void) {
    change();
    setProblem(null);
    setStageJobId(null);
  }

  function showOnStage(jobId: string | null) {
    // Render first: on a phone the stage moves to the top when it shows a
    // video, and a scroll before that lands where it used to be.
    flushSync(() => setStageJobId(jobId));
    stage.current?.scrollIntoView({ block: "nearest" });
  }

  async function handlePhoto(file: File) {
    const mime = resolveUserUploadContentType(file.name, file.type);
    if (!mime || !PHOTO_TYPES.includes(mime) || file.size === 0) {
      setProblem({ step: "presenter", message: t("photoType") });
      return;
    }
    if (file.size > MAX_PHOTO_MIB * 1024 * 1024) {
      setProblem({
        step: "presenter",
        message: t("photoSize", { size: MAX_PHOTO_MIB }),
      });
      return;
    }
    setUploading(true);
    setProblem(null);
    try {
      const { data } = await authClient.getSession();
      if (!data) throw new Error("No active session for the photo upload");
      const result = await uploadDriveFile(
        file,
        driveStoreForActiveWorkspace(data.session.activeOrganizationId ?? null),
      );
      if (!result.resourceId) throw new Error("Photo not finalized");
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      setPhoto({
        id: result.resourceId,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
      });
      setPresenterId(OWN_PHOTO);
      setConsent(false);
      setStageJobId(null);
    } catch (error) {
      setProblem({
        step: "presenter",
        message: isDriveFileUploadDuplicate(error)
          ? tStudio("productPhotoDuplicate")
          : t("photoFailed"),
      });
    } finally {
      setUploading(false);
    }
  }

  function handleWrite() {
    setProblem(null);
    startWriting(async () => {
      const result = await writeTalkingVideoScripts({
        projectId,
        languageCode,
      });
      if (!result.ok || result.value.length === 0) {
        setProblem({ step: "script", message: t("scriptsFailed") });
        return;
      }
      setSuggestions(result.value);
    });
  }

  function handleCreate() {
    if (missing || !model) return;
    setProblem(null);
    const idempotencyKey = `ui:${crypto.randomUUID()}`;
    startStarting(async () => {
      const result = await startTalkingVideo({
        projectId,
        modelId: model.id,
        script: trimmed,
        voice,
        languageCode,
        presenter:
          ownPhoto && photo
            ? { kind: "file", fileId: photo.id, consent: true }
            : { kind: "stock", id: presenterId },
        siteShots,
        broll,
        music,
        idempotencyKey,
      });
      if (!result.ok) {
        const testimonial = result.kind === "talking_video_testimonial";
        setProblem({
          step: testimonial ? "script" : "make",
          message:
            result.kind === CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE
              ? t("notEnoughCredits")
              : testimonial
                ? t("testimonial")
                : result.uncertain
                  ? t("startUncertain")
                  : t("startFailed"),
        });
        return;
      }
      // A list read still in flight predates this video and would drop it.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ProjectTalkingVideos>(queryKey, (current) => ({
        assets: current?.assets ?? [],
        jobs: [
          result.job,
          ...(current?.jobs ?? []).filter((job) => job.id !== result.job.id),
        ],
      }));
      setScript("");
      setSuggestions([]);
      showOnStage(result.job.id);
    });
  }

  function handlePost(asset: TalkingVideoAsset) {
    startPosting(async () => {
      const result = await prepareStudioAssetSocialMedia({
        projectId,
        assetId: asset.id,
      });
      if (!result.ok) {
        toast.error(t("postFailed"));
        return;
      }
      const media = { ...result.value, aiGenerated: true };
      if (tikTokEnabled) {
        try {
          const { data } =
            await coreClient.getProjectsByIdSocialConnections(projectId);
          setComposeVideo({
            media,
            accounts: data.filter((account) => account.provider === "tiktok"),
          });
        } catch {
          toast.error(t("postFailed"));
        }
        return;
      }
      writeSocialComposePrefill(projectId, { media: [media] });
      router.push(
        `/social?projectId=${encodeURIComponent(projectId)}&compose=new`,
      );
    });
  }

  function reuse(job: ProjectImageJob) {
    edit(() => {
      setScript(job.prompt);
      const presenter = job.talkingVideo?.presenterId;
      if (presenterImage(presenter) && presenter) setPresenterId(presenter);
      if (job.talkingVideo?.voice) setVoice(job.talkingVideo.voice);
    });
  }

  const problemFor = (step: NonNullable<Problem>["step"]) =>
    problem?.step === step ? (
      <p className="text-destructive text-sm" role="alert">
        {problem.message}
      </p>
    ) : null;
  const tileClass = (selected: boolean) =>
    cn(
      "bg-muted relative flex aspect-9/16 w-full items-center justify-center overflow-hidden rounded-lg border-2",
      selected ? "border-foreground" : "border-transparent",
    );
  const seconds = talkingVideoQuotedSeconds(trimmed);

  return (
    <div className="grid min-w-0 items-start gap-2 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form
        aria-label={t("formLabel")}
        className={cn(HOLDER_CLASS, "flex min-w-0 flex-col gap-2")}
        onSubmit={(event) => {
          event.preventDefault();
          handleCreate();
        }}
      >
        <Step number={1} title={t("stepPresenter")}>
          <RadioGroup.Root
            aria-label={t("presenter")}
            className="grid grid-cols-5 gap-2 sm:grid-cols-10"
            disabled={readOnly}
            onValueChange={(id) =>
              edit(() => {
                setPresenterId(id);
                // Each presenter comes with a voice that sounds like them.
                const presenterVoice = catalog.presenters.find(
                  (presenter) => presenter.id === id,
                )?.voice;
                if (presenterVoice) setVoice(presenterVoice);
              })
            }
            value={presenterId}
          >
            {catalog.presenters.map((presenter) => (
              <RadioGroup.Item
                className="press flex min-w-0 flex-col gap-1 rounded-lg text-start"
                key={presenter.id}
                title={presenter.description}
                value={presenter.id}
              >
                <span className={tileClass(presenterId === presenter.id)}>
                  <img
                    alt=""
                    className="size-full object-cover"
                    height={160}
                    loading="lazy"
                    src={presenter.imageUrl}
                    width={90}
                  />
                </span>
                <span className="truncate text-xs">{presenter.name}</span>
              </RadioGroup.Item>
            ))}
            {photo ? (
              <RadioGroup.Item
                className="press flex min-w-0 flex-col gap-1 rounded-lg text-start"
                title={photo.name}
                value={OWN_PHOTO}
              >
                <span className={tileClass(ownPhoto)}>
                  <img
                    alt=""
                    className="size-full object-cover"
                    src={photo.previewUrl}
                  />
                </span>
                <span className="truncate text-xs">{t("you")}</span>
              </RadioGroup.Item>
            ) : (
              <button
                className="press flex min-w-0 flex-col gap-1 rounded-lg text-start"
                disabled={readOnly || uploading}
                onClick={() => photoInput.current?.click()}
                title={t("ownPhotoHint")}
                type="button"
              >
                <span className={tileClass(false)}>
                  {uploading ? (
                    <LoaderCircle
                      aria-hidden
                      className="text-muted-foreground size-5 motion-safe:animate-spin"
                    />
                  ) : (
                    <Upload
                      aria-hidden
                      className="text-muted-foreground size-5"
                    />
                  )}
                </span>
                <span className="truncate text-xs">{t("you")}</span>
              </button>
            )}
          </RadioGroup.Root>
          <input
            accept={PHOTO_TYPES.join(",")}
            aria-label={t("ownPhoto")}
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void handlePhoto(file);
            }}
            ref={photoInput}
            type="file"
          />
          {problemFor("presenter")}
          {ownPhoto && photo ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={consent}
                  className="mt-0.5"
                  id={consentId}
                  onCheckedChange={(checked) =>
                    edit(() => setConsent(checked === true))
                  }
                />
                <Label
                  className="text-sm leading-normal font-normal"
                  htmlFor={consentId}
                >
                  {t("consent")}
                </Label>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-2"
                onClick={() => photoInput.current?.click()}
                type="button"
              >
                {t("changePhoto")}
              </button>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              {t("presenterNote")}
            </p>
          )}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={voiceId}>{t("voice")}</Label>
              <Select
                disabled={readOnly}
                onValueChange={(name) => edit(() => setVoice(name))}
                value={voice}
              >
                <SelectTrigger className="w-full" id={voiceId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.voices.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={languageId}>{t("language")}</Label>
              <Select
                disabled={readOnly}
                onValueChange={(code) => edit(() => setLanguageCode(code))}
                value={languageCode}
              >
                <SelectTrigger className="w-full" id={languageId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCRIPT_LANGUAGES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {languageNames.of(code) ?? code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Step>

        <Step
          action={
            <Button
              disabled={readOnly}
              loading={writing}
              onClick={handleWrite}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("writeForMe")}
            </Button>
          }
          number={2}
          title={t("stepScript")}
        >
          <Textarea
            aria-describedby={`${scriptId}-meta`}
            aria-invalid={problem?.step === "script" ? true : undefined}
            aria-label={t("script")}
            className="min-h-32 text-base sm:text-sm"
            disabled={readOnly}
            id={scriptId}
            maxLength={catalog.scriptMaxLength}
            onChange={(event) => edit(() => setScript(event.target.value))}
            placeholder={t("scriptPlaceholder")}
            value={script}
          />
          <div
            className="text-muted-foreground flex flex-wrap justify-between gap-x-4 text-xs tabular-nums"
            id={`${scriptId}-meta`}
          >
            <span>
              {trimmed ? t("scriptLength", { seconds }) : t("scriptHint")}
            </span>
            <span>
              {t("scriptCount", {
                count: script.length,
                max: catalog.scriptMaxLength,
              })}
            </span>
          </div>
          {problemFor("script")}
          {suggestions.length > 0 ? (
            <ul
              aria-label={t("suggestions")}
              className="content-in flex flex-col gap-2"
            >
              {suggestions.map((suggestion) => (
                <li key={suggestion.script}>
                  <button
                    className="border-control-border hover:bg-accent press w-full rounded-lg border p-3 text-start text-sm transition-colors duration-150"
                    onClick={() => {
                      edit(() => setScript(suggestion.script));
                      setSuggestions([]);
                    }}
                    type="button"
                  >
                    <span className="font-medium">{suggestion.hook}</span>
                    <span className="text-muted-foreground mt-1 line-clamp-2">
                      {suggestion.script.slice(suggestion.hook.length).trim() ||
                        suggestion.script}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Step>

        <Step number={3} title={t("stepMake")}>
          <div className="flex flex-col gap-2">
            {hasWebsite ? (
              <Extra
                checked={showSite}
                id={showSiteId}
                label={t("showSite")}
                onChange={(checked) => edit(() => setShowSite(checked))}
              />
            ) : null}
            {model ? (
              <>
                <Extra
                  checked={music}
                  id={musicId}
                  label={t("addMusic", {
                    credits: Math.round(model.price.musicUsd * 100),
                  })}
                  onChange={(checked) => edit(() => setMusic(checked))}
                />
                <Extra
                  checked={broll}
                  id={brollId}
                  label={t("addBroll", {
                    credits: Math.round(model.price.brollUsd * 100),
                  })}
                  onChange={(checked) => edit(() => setBroll(checked))}
                />
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="text-sm tabular-nums" id={makeHintId}>
              {missing || !model ? (
                <span className="text-muted-foreground">{missing}</span>
              ) : (
                <>
                  <span className="font-medium">
                    {tStudio("creditsCount", {
                      count: creditsPerTalkingVideoCents(model.price, trimmed, {
                        siteShots,
                        broll,
                        music,
                      }),
                    })}
                  </span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {t("costDetail")}
                  </span>
                </>
              )}
            </p>
            <Button
              aria-describedby={makeHintId}
              className="w-full sm:w-auto"
              disabled={readOnly || missing !== null}
              loading={starting}
              type="submit"
              variant="primary"
            >
              {t("create")}
            </Button>
          </div>
          {problemFor("make")}
        </Step>
      </form>

      <section
        aria-label={stageJob ? t("stageVideo") : t("preview")}
        className={cn(
          HOLDER_CLASS,
          "flex min-w-0 scroll-mt-2 flex-col gap-2 max-lg:scroll-mt-20 lg:sticky lg:top-0 lg:row-span-2",
          // On a phone a started video leads the page; the preview follows the steps.
          stageJob && "max-lg:order-first",
        )}
        ref={stage}
      >
        <div className="mx-auto flex w-full max-w-72 flex-col gap-2 lg:max-w-none">
          {stageJob ? (
            <StageJob
              asset={assetFor(stageJob)}
              image={presenterImage(stageJob.talkingVideo?.presenterId)}
              job={stageJob}
              onPost={readOnly ? undefined : handlePost}
              postLabel={t(tikTokEnabled ? "postToTikTok" : "post")}
              onReuse={() => reuse(stageJob)}
              posting={posting}
            />
          ) : (
            <StagePreview
              image={ownPhoto ? photo?.previewUrl : presenterImage(presenterId)}
              missingPhoto={ownPhoto && !photo}
              script={trimmed}
            />
          )}
          <div className="flex min-h-8 items-center justify-between gap-2 px-1">
            <p className="text-muted-foreground line-clamp-2 text-xs">
              {stageJob
                ? stageJob.prompt
                : t("previewMeta", {
                    voice,
                    language: languageNames.of(languageCode) ?? languageCode,
                  })}
            </p>
            {stageJob ? (
              <Button
                className="shrink-0"
                onClick={() => setStageJobId(null)}
                size="sm"
                variant="ghost"
              >
                {t("newVideo")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {composeVideo ? (
        <TikTokComposer
          open
          projectId={projectId}
          connections={composeVideo.accounts}
          mode={{
            kind: "create",
            source: "tiktok-studio",
            media: [composeVideo.media],
          }}
          onConnectAccount={() =>
            router.push(
              `/social?projectId=${encodeURIComponent(projectId)}&tab=accounts`,
            )
          }
          onOpenChange={(open) => {
            if (!open) setComposeVideo(null);
          }}
          onError={(error) => toast.error(error.message || t("postFailed"))}
          onSaved={() => router.refresh()}
        />
      ) : null}
      {videos.jobs.length > 0 ? (
        <TikTokStudioLibrary
          assetFor={assetFor}
          jobs={videos.jobs}
          onSelect={(job) => showOnStage(job.id)}
          selectedId={stageJob?.id ?? null}
        />
      ) : null}
    </div>
  );
}

/** One step of making a video, numbered in the order it is done. */
function Step({
  number,
  title,
  action,
  children,
}: {
  number: number;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(HOLDER_ITEM_CLASS, "flex min-w-0 flex-col gap-3 p-4")}
    >
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <span
            aria-hidden
            className="bg-quinary text-muted-foreground text-2xs flex size-5 items-center justify-center rounded-full tabular-nums"
          >
            {number}
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
