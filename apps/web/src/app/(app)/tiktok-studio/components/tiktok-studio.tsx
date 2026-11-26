"use client";

import type {
  ProjectImageAsset,
  ProjectImageJob,
  ProjectImageStudioTalkingVideoCatalog,
  ProjectSocialConnection,
  SocialPostMediaRef,
} from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  creditsPerShortVideoCents,
  creditsPerTalkingVideoCents,
  resolveUserUploadContentType,
  SHORT_VIDEO_MAX_PICTURES,
  talkingVideoQuotedSeconds,
  VIDEO_RECIPES,
  type VideoShape,
  videoShapesFor,
} from "@sokosumi/utils";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { APP_MAIN_MOBILE_SCROLL_MT_CLASS } from "@/app/components/app-shell-safe-area";
import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSocialProviderAvailability } from "@/contexts/social-provider-availability-context";
import {
  prepareStudioAssetSocialMedia,
  startShortVideo,
  startTalkingVideo,
  writeTalkingVideoScripts,
} from "@/lib/actions/image-studio/action";
import { authClient } from "@/lib/auth/auth.client";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { TalkingVideoPage } from "@/lib/services/image-studio.service";
import { writeSocialComposePrefill } from "@/lib/social-compose-prefill";
import { cn } from "@/lib/utils";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";

import {
  OWN_PHOTO,
  PHOTO_TYPES,
  PresenterControls,
  type PresenterPhoto,
  SCRIPT_LANGUAGES,
  VoiceControls,
} from "./presenter-controls";
import {
  ShortPictures,
  shortFormatSpeaks,
  type VideoKind,
  VideoKindPicker,
} from "./short-format-controls";
import { TikTokStudioLibrary } from "./tiktok-studio-library";
import {
  ACTIVE_STATUSES,
  type Playback,
  StageJob,
  StagePreview,
  type TalkingVideoAsset,
} from "./tiktok-studio-stage";
import { useTalkingVideoHistory } from "./use-talking-video-history";
import { ShapePicker, ShapeTabs, shapeFamily, shapeOf } from "./video-shapes";

const TikTokComposer = dynamic(() =>
  import(
    "@/app/projects/components/social-posts/social-post-composer-dialog"
  ).then((module) => module.SocialPostComposerDialog),
);

const MAX_PHOTO_MIB = 12;
/** As long as Core keeps a hook line. */
const HOOK_LINE_MAX_LENGTH = 48;
type Script = { hook: string; script: string; hookLine?: string };
/** Pictures chosen for a short before the person picks any. */
const PRESELECTED_PICTURES = 4;

/** Something that went wrong, shown beside the step it belongs to. */
type Problem = {
  step: "presenter" | "script" | "make";
  message: string;
} | null;

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
  pictures,
  catalog,
  initialVideos,
  readOnly,
}: {
  projectId: string;
  /** The Project has a website a video can show. */
  hasWebsite: boolean;
  /** The Project's newest studio pictures, for a short to show. */
  pictures: ProjectImageAsset[];
  catalog: ProjectImageStudioTalkingVideoCatalog;
  initialVideos: TalkingVideoPage;
  /** A CMO Project is changed in CMO only. */
  readOnly: boolean;
}) {
  const t = useTranslations("App.TikTokStudio");
  const tStudio = useTranslations("App.Studio");
  const locale = useLocale();
  const router = useRouter();
  const scriptId = useId();
  const showSiteId = useId();
  const musicId = useId();
  const brollId = useId();
  const makeHintId = useId();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<VideoKind>("presenter");
  const short = kind === "presenter" ? null : kind;
  const spoken = shortFormatSpeaks(kind);
  const [pictureIds, setPictureIds] = useState<string[]>(() =>
    pictures.slice(0, PRESELECTED_PICTURES).map((picture) => picture.id),
  );
  const [hookLine, setHookLine] = useState("");
  const hookLineId = useId();
  const [script, setScript] = useState("");
  const [presenterId, setPresenterId] = useState(
    catalog.presenters[0]?.id ?? OWN_PHOTO,
  );
  const [photo, setPhoto] = useState<PresenterPhoto | null>(null);
  const [consent, setConsent] = useState(false);
  const [showSite, setShowSite] = useState(true);
  const siteShots = hasWebsite && showSite;
  const [music, setMusic] = useState(false);
  const [broll, setBroll] = useState(false);
  const [wantedShapes, setWantedShapes] = useState<VideoShape[]>(["9:16"]);
  const [previewShape, setPreviewShape] = useState<VideoShape>("9:16");
  /** The shape of the stage's video being watched; none shows the first. */
  const [stageShape, setStageShape] = useState<VideoShape | null>(null);
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
  const videos = useTalkingVideoHistory(projectId, initialVideos, stageJobId);
  const queryKey = videos.queryKey;
  /** What the stage player found for each finished video's file, by asset. */
  const [playback, setPlayback] = useState<Record<string, Playback>>({});
  const stage = useRef<HTMLElement>(null);
  const form = useRef<HTMLFormElement>(null);

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
    videos.assetsByJob.get(job.id) ?? null;
  const recipe = VIDEO_RECIPES[kind];
  const shapes = videoShapesFor(recipe, wantedShapes);
  const shownPreviewShape = shapes.includes(previewShape)
    ? previewShape
    : shapes[0]!;
  const stageSource = videos.jobs.find((job) => job.id === stageJobId) ?? null;
  const stageFamily = stageSource ? shapeFamily(videos.jobs, stageSource) : [];
  const stageJob =
    stageFamily.find((job) => shapeOf(job) === stageShape) ??
    stageFamily[0] ??
    stageSource;
  const stageAsset = stageJob ? assetFor(stageJob) : null;
  const playbackFor = (asset: TalkingVideoAsset) => playback[asset.id];
  const markPlayback = (asset: TalkingVideoAsset, next: Playback) =>
    setPlayback((current) =>
      current[asset.id] === next ? current : { ...current, [asset.id]: next },
    );

  const firstPicture = pictures.find((picture) => picture.id === pictureIds[0]);
  /** What still stands between the person and the button, if anything. */
  const missing =
    trimmed.length < catalog.scriptMinLength
      ? t("needScript", { count: catalog.scriptMinLength })
      : short
        ? pictureIds.length === 0 && !hasWebsite
          ? t("picturesMissing")
          : null
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
    flushSync(() => {
      videos.pinSelection(jobId);
      setStageJobId(jobId);
      setStageShape(null);
    });
    stage.current?.scrollIntoView({ block: "nearest" });
  }

  /** Clears the stage and takes the person to the form for a new video. */
  function startNew() {
    flushSync(() => setStageJobId(null));
    form.current?.scrollIntoView({ block: "start" });
    form.current?.focus({ preventScroll: true });
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
        ...(short ? { format: short } : {}),
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
      const result = short
        ? await startShortVideo({
            projectId,
            format: short,
            script: trimmed,
            hookLine: spoken ? hookLine.trim() || undefined : undefined,
            voice,
            languageCode,
            pictureAssetIds: pictureIds,
            shapes,
            idempotencyKey,
          })
        : await startTalkingVideo({
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
            shapes,
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
      queryClient.setQueryData<TalkingVideoPage>(queryKey, (current) => ({
        ...current,
        assets: current?.assets ?? [],
        jobs: [
          result.job,
          ...(current?.jobs ?? []).filter((job) => job.id !== result.job.id),
        ],
      }));
      setScript("");
      setHookLine("");
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
      setKind(job.talkingVideo?.format ?? "presenter");
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
  const seconds = talkingVideoQuotedSeconds(trimmed);

  return (
    <div className="grid min-w-0 items-start gap-2 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {videos.jobs.length > 0 ? (
        <TikTokStudioLibrary
          assetFor={assetFor}
          // Each video once: its other shapes are on the stage.
          jobs={videos.libraryJobs.filter(
            (job) => !job.talkingVideo?.sourceJobId,
          )}
          retryHistory={videos.retry}
          onNew={readOnly ? undefined : startNew}
          onSelect={(job) => showOnStage(job.id)}
          playbackFor={playbackFor}
          selectedId={stageSource?.id ?? null}
        />
      ) : null}
      <section
        aria-label={stageJob ? t("stageVideo") : t("preview")}
        className={cn(
          HOLDER_CLASS,
          // The library and the form share the first column; the stage stays beside
          // both. It comes before the form so the keyboard reaches it first.
          "flex min-w-0 scroll-mt-2 flex-col gap-2 lg:sticky lg:top-0 lg:col-start-2 lg:row-span-2 lg:row-start-1",
          APP_MAIN_MOBILE_SCROLL_MT_CLASS,
          // On a phone a started video leads the page; the preview follows the steps.
          stageJob ? "max-lg:order-first" : "max-lg:order-last",
        )}
        ref={stage}
      >
        <div className="mx-auto flex w-full max-w-72 flex-col gap-2 lg:max-w-none">
          {stageJob ? (
            <ShapeTabs
              label={t("shapes.onStage")}
              making={
                new Set(
                  stageFamily
                    .filter((job) => ACTIVE_STATUSES.has(job.status))
                    .map(shapeOf),
                )
              }
              onChange={setStageShape}
              shapes={stageFamily.map(shapeOf)}
              value={shapeOf(stageJob)}
            />
          ) : (
            <ShapeTabs
              label={t("shapes.previewIn")}
              onChange={setPreviewShape}
              shapes={shapes}
              value={shownPreviewShape}
            />
          )}
          {stageJob ? (
            <StageJob
              asset={stageAsset}
              // Each video's own retry: a failure elsewhere never takes focus.
              key={stageJob.id}
              onPlayback={(next) => {
                if (stageAsset) markPlayback(stageAsset, next);
              }}
              playback={stageAsset ? playbackFor(stageAsset) : undefined}
              image={presenterImage(stageJob.talkingVideo?.presenterId)}
              job={stageJob}
              onPost={readOnly ? undefined : handlePost}
              postLabel={t(tikTokEnabled ? "postToTikTok" : "post")}
              onReuse={() => reuse(stageJob)}
              posting={posting}
            />
          ) : (
            <StagePreview
              captions={spoken}
              hookLine={
                short
                  ? spoken
                    ? hookLine.trim() || undefined
                    : trimmed.split("\n")[0]?.trim() || undefined
                  : undefined
              }
              image={
                short
                  ? firstPicture && assetContentUrl(firstPicture)
                  : ownPhoto
                    ? photo?.previewUrl
                    : presenterImage(presenterId)
              }
              missingPhoto={!short && ownPhoto && !photo}
              script={trimmed}
              shape={shownPreviewShape}
            />
          )}
          <div className="flex min-h-8 items-center justify-between gap-2 px-1">
            <p className="text-muted-foreground line-clamp-2 text-xs">
              {stageJob
                ? stageJob.prompt
                : spoken
                  ? t("previewMeta", {
                      voice,
                      language: languageNames.of(languageCode) ?? languageCode,
                    })
                  : t("previewMetaSlideshow")}
            </p>
            {stageJob ? (
              <Button
                className="shrink-0"
                // A read-only project has no form to go to.
                onClick={readOnly ? () => setStageJobId(null) : startNew}
                size="sm"
                variant="ghost"
              >
                {t("newVideo")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
      <form
        aria-label={t("formLabel")}
        className={cn(
          HOLDER_CLASS,
          "focus-visible:ring-ring focus-visible:ring-offset-background flex min-w-0 scroll-mt-2 flex-col gap-2 outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          APP_MAIN_MOBILE_SCROLL_MT_CLASS,
        )}
        ref={form}
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          handleCreate();
        }}
      >
        <Step number={1} title={t("stepKind")}>
          <VideoKindPicker
            hasWebsite={hasWebsite}
            onChange={(next) =>
              edit(() => {
                setKind(next);
                setSuggestions([]);
              })
            }
            presenterImage={presenterImage(presenterId)}
            readOnly={readOnly}
            value={kind}
          />
        </Step>

        {short ? (
          <Step number={2} title={t("stepShows")}>
            <ShortPictures
              chosen={pictureIds}
              max={SHORT_VIDEO_MAX_PICTURES}
              onChange={(ids) => edit(() => setPictureIds(ids))}
              pictures={pictures}
              readOnly={readOnly}
            />
            <p className="text-muted-foreground text-xs">
              {hasWebsite
                ? t("picturesNoteWithSite", { max: SHORT_VIDEO_MAX_PICTURES })
                : t("picturesNote", { max: SHORT_VIDEO_MAX_PICTURES })}
            </p>
            {problemFor("presenter")}
            {spoken ? (
              <VoiceControls
                catalog={catalog}
                languageCode={languageCode}
                languageNames={languageNames}
                onLanguageChange={(code) => edit(() => setLanguageCode(code))}
                onVoiceChange={(name) => edit(() => setVoice(name))}
                readOnly={readOnly}
                voice={voice}
              />
            ) : null}
          </Step>
        ) : (
          <Step number={2} title={t("stepPresenter")}>
            <PresenterControls
              catalog={catalog}
              presenterId={presenterId}
              photo={photo}
              consent={consent}
              voice={voice}
              languageCode={languageCode}
              languageNames={languageNames}
              readOnly={readOnly}
              uploading={uploading}
              problem={problemFor("presenter")}
              onConsentChange={(checked) => edit(() => setConsent(checked))}
              onVoiceChange={(name) => edit(() => setVoice(name))}
              onLanguageChange={(code) => edit(() => setLanguageCode(code))}
              onPhoto={handlePhoto}
              onPresenterChange={(id) =>
                edit(() => {
                  setPresenterId(id);
                  // Each presenter comes with a voice that sounds like them.
                  const presenterVoice = catalog.presenters.find(
                    (presenter) => presenter.id === id,
                  )?.voice;
                  if (presenterVoice) setVoice(presenterVoice);
                })
              }
            />
          </Step>
        )}

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
          number={3}
          title={t(
            short
              ? spoken
                ? "stepScriptVoice"
                : "stepScriptSlideshow"
              : "stepScript",
          )}
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
            placeholder={t(
              short ? `scriptPlaceholders.${short}` : "scriptPlaceholder",
            )}
            value={script}
          />
          <div
            className="text-muted-foreground flex flex-wrap justify-between gap-x-4 text-xs tabular-nums"
            id={`${scriptId}-meta`}
          >
            <span>
              {trimmed && spoken
                ? t("scriptLength", { seconds })
                : t(short ? `scriptHints.${short}` : "scriptHint")}
            </span>
            <span>
              {t("scriptCount", {
                count: script.length,
                max: catalog.scriptMaxLength,
              })}
            </span>
          </div>
          {short && spoken ? (
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={hookLineId}>{t("hookLine")}</Label>
              <Input
                aria-describedby={`${hookLineId}-hint`}
                disabled={readOnly}
                id={hookLineId}
                maxLength={HOOK_LINE_MAX_LENGTH}
                onChange={(event) =>
                  edit(() => setHookLine(event.target.value))
                }
                placeholder={t("hookLinePlaceholder")}
                value={hookLine}
              />
              <p
                className="text-muted-foreground text-xs"
                id={`${hookLineId}-hint`}
              >
                {t("hookLineHint")}
              </p>
            </div>
          ) : null}
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
                      edit(() => {
                        setScript(suggestion.script);
                        if (suggestion.hookLine)
                          setHookLine(suggestion.hookLine);
                      });
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

        <Step number={4} title={t("stepMake")}>
          {short ? (
            <p className="text-muted-foreground text-sm">
              {t(spoken ? "shortIncludes" : "slideshowIncludes")}
            </p>
          ) : null}
          <div className={cn("flex flex-col gap-2", short && "hidden")}>
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
          <ShapePicker
            allowed={recipe.shapes}
            onChange={(next) =>
              edit(() => {
                setWantedShapes(next);
                if (!next.includes(previewShape)) setPreviewShape(next[0]!);
                else if (next.length > shapes.length)
                  setPreviewShape(
                    next.find((shape) => !shapes.includes(shape)) ?? next[0]!,
                  );
              })
            }
            readOnly={readOnly}
            value={shapes}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="text-sm tabular-nums" id={makeHintId}>
              {missing || !model ? (
                <span className="text-muted-foreground">{missing}</span>
              ) : (
                <>
                  <span className="font-medium">
                    {tStudio("creditsCount", {
                      count: short
                        ? creditsPerShortVideoCents(model.price, trimmed, short)
                        : creditsPerTalkingVideoCents(model.price, trimmed, {
                            siteShots,
                            broll,
                            music,
                          }),
                    })}
                  </span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {t(short ? "costDetailShort" : "costDetail")}
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
