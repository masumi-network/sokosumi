"use client";

import type {
  ProjectImageJob,
  ProjectImageStudioTalkingVideoCatalog,
  ProjectTalkingVideos,
} from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  creditsPerTalkingVideoCents,
  resolveUserUploadContentType,
  talkingVideoQuotedSeconds,
} from "@sokosumi/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle, PenLine, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";

import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { Badge } from "@/components/ui/badge";
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
import {
  startTalkingVideo,
  writeTalkingVideoScripts,
} from "@/lib/actions/image-studio/action";
import { authClient } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_MIB = 12;
const POLL_MS = 4_000;
const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
]);
/** Languages the voices speak well; the reader's own comes first. */
const SCRIPT_LANGUAGES = ["en", "de", "es", "fr", "it", "pt", "nl"] as const;
const OWN_PHOTO = "own-photo";

type Script = { hook: string; script: string };

/** The field whose problem is shown beside it. */
type Problem = {
  field: "script" | "presenter" | "consent" | "form";
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

export function TikTokStudio({
  projectId,
  catalog,
  initialVideos,
  readOnly,
}: {
  projectId: string;
  catalog: ProjectImageStudioTalkingVideoCatalog;
  initialVideos: ProjectTalkingVideos;
  /** A CMO Project is changed in CMO only. */
  readOnly: boolean;
}) {
  const t = useTranslations("App.TikTokStudio");
  const tStudio = useTranslations("App.Studio");
  const locale = useLocale();
  const ids = { script: useId(), voice: useId() };
  const languageId = useId();
  const consentId = useId();
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
  const [voice, setVoice] = useState(catalog.defaultVoice);
  const [languageCode, setLanguageCode] = useState<string>(
    SCRIPT_LANGUAGES.find((code) => locale.startsWith(code)) ?? "en",
  );
  const [suggestions, setSuggestions] = useState<Script[]>([]);
  const [problem, setProblem] = useState<Problem>(null);
  const [uploading, setUploading] = useState(false);
  const [writing, startWriting] = useTransition();
  const [starting, startStarting] = useTransition();
  const photoInput = useRef<HTMLInputElement>(null);

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
  const credits =
    model && trimmed.length >= catalog.scriptMinLength
      ? creditsPerTalkingVideoCents(model.price, trimmed)
      : null;
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });

  async function handlePhoto(file: File) {
    const mime = resolveUserUploadContentType(file.name, file.type);
    if (!mime || !PHOTO_TYPES.includes(mime) || file.size === 0) {
      setProblem({ field: "presenter", message: t("photoType") });
      return;
    }
    if (file.size > MAX_PHOTO_MIB * 1024 * 1024) {
      setProblem({
        field: "presenter",
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
    } catch (error) {
      setProblem({
        field: "presenter",
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
        setProblem({ field: "script", message: t("scriptsFailed") });
        return;
      }
      setSuggestions(result.value);
    });
  }

  function handleCreate() {
    if (trimmed.length < catalog.scriptMinLength) {
      setProblem({
        field: "script",
        message: t("scriptTooShort", { count: catalog.scriptMinLength }),
      });
      return;
    }
    const ownPhoto = presenterId === OWN_PHOTO;
    if (ownPhoto && !photo) {
      setProblem({ field: "presenter", message: t("photoMissing") });
      return;
    }
    if (ownPhoto && !consent) {
      setProblem({ field: "consent", message: t("consentMissing") });
      return;
    }
    if (!model) return;
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
        idempotencyKey,
      });
      if (!result.ok) {
        setProblem({
          field:
            result.kind === "talking_video_testimonial" ? "script" : "form",
          message:
            result.kind === CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE
              ? t("notEnoughCredits")
              : result.kind === "talking_video_testimonial"
                ? t("testimonial")
                : result.uncertain
                  ? t("startUncertain")
                  : t("startFailed"),
        });
        return;
      }
      queryClient.setQueryData<ProjectTalkingVideos>(queryKey, (current) => ({
        assets: current?.assets ?? [],
        jobs: [
          result.job,
          ...(current?.jobs ?? []).filter((job) => job.id !== result.job.id),
        ],
      }));
      setScript("");
      setSuggestions([]);
    });
  }

  const problemFor = (field: NonNullable<Problem>["field"]) =>
    problem?.field === field ? problem.message : null;
  const scriptProblem = problemFor("script");
  const presenterProblem = problemFor("presenter");
  const consentProblem = problemFor("consent");
  const formProblem = problemFor("form");

  return (
    <div className="grid min-w-0 items-start gap-2 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <form
        aria-label={t("formLabel")}
        className={cn(HOLDER_CLASS, "flex min-w-0 flex-col gap-2")}
        onSubmit={(event) => {
          event.preventDefault();
          handleCreate();
        }}
      >
        <div className={cn(HOLDER_ITEM_CLASS, "flex flex-col gap-2 p-4")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={ids.script}>{t("script")}</Label>
            <Button
              disabled={readOnly}
              loading={writing}
              onClick={handleWrite}
              size="sm"
              type="button"
              variant="outline"
            >
              <PenLine aria-hidden />
              {t("writeFromBrand")}
            </Button>
          </div>
          <Textarea
            aria-describedby={`${ids.script}-meta`}
            aria-invalid={scriptProblem ? true : undefined}
            className="min-h-36 text-base sm:text-sm"
            disabled={readOnly}
            id={ids.script}
            maxLength={catalog.scriptMaxLength}
            onChange={(event) => setScript(event.target.value)}
            placeholder={t("scriptPlaceholder")}
            value={script}
          />
          <div
            className="text-muted-foreground flex flex-wrap justify-between gap-x-4 text-xs tabular-nums"
            id={`${ids.script}-meta`}
          >
            <span>
              {trimmed
                ? t("scriptLength", {
                    seconds: talkingVideoQuotedSeconds(trimmed),
                  })
                : t("scriptHint")}
            </span>
            <span>
              {t("scriptCount", {
                count: script.length,
                max: catalog.scriptMaxLength,
              })}
            </span>
          </div>
          {scriptProblem ? (
            <p className="text-destructive text-sm" role="alert">
              {scriptProblem}
            </p>
          ) : null}
          {suggestions.length > 0 ? (
            <ul aria-label={t("suggestions")} className="flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion.script}>
                  <button
                    className="border-border hover:bg-accent focus-visible:ring-ring w-full rounded-lg border p-3 text-start text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    onClick={() => {
                      setScript(suggestion.script);
                      setProblem(null);
                    }}
                    type="button"
                  >
                    <span className="font-medium">{suggestion.hook}</span>
                    <span className="text-muted-foreground mt-1 block text-pretty">
                      {suggestion.script.slice(suggestion.hook.length).trim() ||
                        suggestion.script}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <fieldset
          className={cn(HOLDER_ITEM_CLASS, "flex min-w-0 flex-col gap-3 p-4")}
          disabled={readOnly}
        >
          <legend className="sr-only">{t("presenter")}</legend>
          <div aria-hidden className="text-sm font-medium">
            {t("presenter")}
          </div>
          <div
            aria-label={t("presenter")}
            className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-4"
            role="radiogroup"
          >
            {catalog.presenters.map((presenter) => (
              <PresenterTile
                image={presenter.imageUrl}
                key={presenter.id}
                label={presenter.name}
                onSelect={() => setPresenterId(presenter.id)}
                selected={presenterId === presenter.id}
                title={presenter.description}
              />
            ))}
            <PresenterTile
              busy={uploading}
              image={photo?.previewUrl}
              label={photo ? photo.name : t("ownPhoto")}
              onSelect={() =>
                photo ? setPresenterId(OWN_PHOTO) : photoInput.current?.click()
              }
              selected={presenterId === OWN_PHOTO}
              title={t("ownPhotoHint")}
            />
          </div>
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
          <p className="text-muted-foreground text-xs text-pretty">
            {t("presenterNote")}
          </p>
          {presenterProblem ? (
            <p className="text-destructive text-sm" role="alert">
              {presenterProblem}
            </p>
          ) : null}
          {presenterId === OWN_PHOTO && photo ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <Checkbox
                  aria-describedby={
                    consentProblem ? `${consentId}-error` : undefined
                  }
                  aria-invalid={consentProblem ? true : undefined}
                  checked={consent}
                  className="mt-0.5"
                  id={consentId}
                  onCheckedChange={(checked) => setConsent(checked === true)}
                />
                <Label
                  className="text-sm leading-normal font-normal"
                  htmlFor={consentId}
                >
                  {t("consent")}
                </Label>
              </div>
              {consentProblem ? (
                <p
                  className="text-destructive text-sm"
                  id={`${consentId}-error`}
                  role="alert"
                >
                  {consentProblem}
                </p>
              ) : null}
              <button
                className="text-muted-foreground hover:text-foreground w-fit text-xs underline underline-offset-2"
                onClick={() => photoInput.current?.click()}
                type="button"
              >
                {t("changePhoto")}
              </button>
            </div>
          ) : null}
        </fieldset>

        <fieldset
          className={cn(
            HOLDER_ITEM_CLASS,
            "grid min-w-0 gap-3 p-4 sm:grid-cols-2",
          )}
          disabled={readOnly}
        >
          <legend className="sr-only">{t("settings")}</legend>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={ids.voice}>{t("voice")}</Label>
            <Select onValueChange={setVoice} value={voice}>
              <SelectTrigger className="w-full" id={ids.voice}>
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
            <Select onValueChange={setLanguageCode} value={languageCode}>
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
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 pb-1">
          <p className="text-sm tabular-nums">
            {credits === null ? (
              <span className="text-muted-foreground">{t("costHint")}</span>
            ) : (
              <>
                <span className="font-medium">
                  {tStudio("creditsCount", { count: credits })}
                </span>
                <span className="text-muted-foreground">
                  {" · "}
                  {t("chargedOnDelivery")}
                </span>
              </>
            )}
          </p>
          <Button disabled={readOnly} loading={starting} type="submit">
            {t("create")}
          </Button>
          {formProblem ? (
            <p className="text-destructive w-full text-sm" role="alert">
              {formProblem}
            </p>
          ) : null}
        </div>
      </form>

      <section aria-label={t("videos")} className={cn(HOLDER_CLASS, "min-w-0")}>
        {videos.jobs.length === 0 ? (
          <div
            className={cn(
              HOLDER_ITEM_CLASS,
              "flex min-h-64 flex-col items-center justify-center gap-1 p-6 text-center",
            )}
          >
            <p className="font-medium">{t("emptyTitle")}</p>
            <p className="text-muted-foreground max-w-prose text-sm text-pretty">
              {t("emptyBody")}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
            {videos.jobs.map((job) => (
              <VideoTile
                asset={
                  videos.assets.find((asset) => asset.jobId === job.id) ?? null
                }
                job={job}
                key={job.id}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PresenterTile({
  image,
  label,
  title,
  selected,
  busy = false,
  onSelect,
}: {
  image?: string;
  label: string;
  title: string;
  selected: boolean;
  busy?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-checked={selected}
      className={cn(
        "group focus-visible:ring-ring flex min-w-0 flex-col gap-1 rounded-lg text-start focus-visible:ring-2 focus-visible:outline-none",
      )}
      onClick={onSelect}
      role="radio"
      title={title}
      type="button"
    >
      <span
        className={cn(
          "bg-muted relative flex aspect-9/16 w-full items-center justify-center overflow-hidden rounded-lg border-2",
          selected ? "border-foreground" : "border-transparent",
        )}
      >
        {image ? (
          <img
            alt=""
            className="size-full object-cover"
            height={320}
            loading="lazy"
            src={image}
            width={180}
          />
        ) : busy ? (
          <LoaderCircle
            aria-hidden
            className="text-muted-foreground size-5 motion-safe:animate-spin"
          />
        ) : (
          <Upload aria-hidden className="text-muted-foreground size-5" />
        )}
      </span>
      <span className="truncate text-xs">{label}</span>
    </button>
  );
}

function VideoTile({
  job,
  asset,
}: {
  job: ProjectImageJob;
  asset: ProjectTalkingVideos["assets"][number] | null;
}) {
  const t = useTranslations("App.TikTokStudio");
  const tStudio = useTranslations("App.Studio");
  const active = ACTIVE_STATUSES.has(job.status);
  return (
    <li className={cn(HOLDER_ITEM_CLASS, "flex min-w-0 flex-col p-2")}>
      <div className="bg-muted relative flex aspect-9/16 w-full items-center justify-center overflow-hidden rounded-md">
        {asset ? (
          <video
            aria-label={job.prompt}
            className="size-full object-cover"
            controls
            playsInline
            preload="metadata"
            src={assetContentUrl(asset)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 p-3 text-center text-sm">
            {active ? (
              <>
                <LoaderCircle
                  aria-hidden
                  className="text-muted-foreground size-5 motion-safe:animate-spin"
                />
                <span role="status">{t("making")}</span>
                <span className="text-muted-foreground text-xs text-pretty">
                  {t("makingHint")}
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">{t("failed")}</span>
                <span className="text-muted-foreground text-xs text-pretty">
                  {job.failureReason
                    ? tStudio(`FailureReasons.${job.failureReason}`)
                    : (job.error ?? t("failedBody"))}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-pretty" title={job.prompt}>
        {job.prompt}
      </p>
      {asset ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Badge title={t("aiLabelHint")} variant="outline">
            {t("aiLabel")}
          </Badge>
          <Button asChild size="sm" variant="ghost">
            <a download href={assetContentUrl(asset, { download: true })}>
              <Download aria-hidden />
              {t("download")}
            </a>
          </Button>
        </div>
      ) : null}
    </li>
  );
}
