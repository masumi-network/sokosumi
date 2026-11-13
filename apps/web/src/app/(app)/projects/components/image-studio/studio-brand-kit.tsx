import type {
  SaveStudioBrandLook,
  StudioBrandCopy,
  StudioBrandKit,
  StudioLogoPosition,
  StudioWebsiteCopy,
  StudioWebsiteVisual,
} from "@sokosumi/core-client";
import {
  ENTITY_IMAGE_MAX_SIZE_BYTES,
  isStudioLogoMime,
  resolveUserUploadContentType,
  STUDIO_LOGO_MIME_TYPES,
} from "@sokosumi/utils";
import {
  ExternalLink,
  Globe,
  ImagePlus,
  Palette,
  WandSparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";

import { DesignMdGenerateDialog } from "@/components/design-md/design-md-generate-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  findStudioWebsiteLogo,
  getStudioBrandKit,
  getStudioWebsiteCopy,
  saveStudioBrandCopy,
  saveStudioBrandLook,
  saveStudioLogoPosition,
  saveStudioWebsiteLogo,
  uploadStudioProjectLogo,
} from "@/lib/actions/image-studio/brand-kit";

import { StudioLogoPositionSelect } from "./studio-logo-position-select";
import {
  STUDIO_TOOLBAR_LABEL_CLASS,
  StudioToolbarTip,
} from "./studio-project-toolbar";

const MAX_LINES = 8;
const MAX_AUDIENCE_LENGTH = 400;
const MAX_COPY_LENGTH = 2_000;

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function StudioBrandKitDialog({
  disabled,
  onLogoChange,
  onWebsiteCopyReviewed,
  onWebsiteVisualReviewed,
  projectId,
  websiteCopy,
  websiteVisual,
  websiteUrl,
}: {
  disabled?: boolean;
  onLogoChange: (
    logo: string | null,
    position: StudioLogoPosition | null,
  ) => void;
  onWebsiteCopyReviewed?: () => void;
  onWebsiteVisualReviewed?: (part: "logo" | "look") => void;
  projectId: string;
  websiteCopy?: StudioWebsiteCopy | null;
  websiteVisual?: StudioWebsiteVisual | null;
  websiteUrl?: string | null;
}) {
  const t = useTranslations("App.Studio");
  const [open, setOpen] = useState(false);
  const [kit, setKit] = useState<StudioBrandKit | null>(null);
  const [draft, setDraft] = useState({
    summary: "",
    tone: "",
    audience: "",
    approvedLines: "",
  });
  const [dirty, setDirty] = useState(false);
  const [lookDraft, setLookDraft] = useState<{
    colors: string;
    fonts: string;
    websiteColors?: string[];
  } | null>(null);
  const [lookMessage, setLookMessage] = useState<
    "lookSaved" | "lookReset" | "lookSaveError" | "lookConflict" | null
  >(null);
  const [logoPositionDraft, setLogoPositionDraft] =
    useState<StudioLogoPosition | null>(null);
  const [websiteStyleSaved, setWebsiteStyleSaved] = useState(false);
  const [message, setMessage] = useState<
    "saved" | "loadError" | "saveError" | "conflict" | null
  >(null);
  const [brandPending, startTransition] = useTransition();
  const [logoPending, startLogoTransition] = useTransition();
  const [websiteLogoPending, startWebsiteLogoTransition] = useTransition();
  const [websitePending, startWebsiteTransition] = useTransition();
  const [lookPending, startLookTransition] = useTransition();
  const pending =
    brandPending ||
    logoPending ||
    websiteLogoPending ||
    websitePending ||
    lookPending;
  const logoInput = useRef<HTMLInputElement>(null);
  const [foundLogo, setFoundLogo] = useState<string | null>(null);
  const websiteLogo =
    websiteVisual?.logo !== kit?.logo ? websiteVisual?.logo : null;
  const logoCandidate = foundLogo ?? websiteLogo;
  const [logoMessage, setLogoMessage] = useState<
    | "logoSaved"
    | "logoPositionSaved"
    | "logoPositionError"
    | "logoUploadError"
    | "logoFileInvalid"
    | "websiteLogoMissing"
    | "websiteLogoError"
    | null
  >(null);
  const [websiteMessage, setWebsiteMessage] = useState<
    | "websiteCopyAdded"
    | "websiteCopyEmpty"
    | "websiteCopyError"
    | "websiteProfileAdded"
    | null
  >(null);
  const copy: StudioBrandCopy = {
    summary: draft.summary.trim(),
    tone: draft.tone.trim(),
    audience: lines(draft.audience),
    approvedLines: lines(draft.approvedLines),
  };
  const invalidLines =
    copy.audience.length > MAX_LINES ||
    copy.approvedLines.length > MAX_LINES ||
    copy.audience.some((line) => line.length > MAX_AUDIENCE_LENGTH) ||
    copy.approvedLines.some((line) => line.length > MAX_COPY_LENGTH);
  const look = lookDraft
    ? { colors: lines(lookDraft.colors), fonts: lines(lookDraft.fonts) }
    : null;
  const invalidColors =
    look &&
    (look.colors.length > 8 ||
      look.colors.some(
        (color) => !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color),
      ));
  const invalidFonts =
    look &&
    (look.fonts.length > 4 ||
      look.fonts.some(
        (font) => font.length > 80 || /[\p{Cc}\p{Cf}]/u.test(font),
      ));
  const invalidLook = !!(invalidColors || invalidFonts);
  const reviewsCurrentWebsiteLook =
    !!lookDraft?.websiteColors &&
    lookDraft.websiteColors === websiteVisual?.colors;
  const swatches = look
    ? invalidColors
      ? []
      : [...new Set(look.colors)]
    : (kit?.colors ?? []);

  function load() {
    startTransition(async () => {
      setMessage(null);
      setLogoMessage(null);
      setFoundLogo(null);
      setWebsiteMessage(null);
      setWebsiteStyleSaved(false);
      setLookDraft(null);
      setLookMessage(null);
      try {
        const next = await getStudioBrandKit({ projectId });
        setKit(next);
        const position = next.studioLogoPosition ?? null;
        setLogoPositionDraft(position);
        onLogoChange(next.logo, position);
        const savedDraft = {
          summary: next.summary,
          tone: next.tone,
          audience: next.audience.join("\n"),
          approvedLines: next.approvedLines.join("\n"),
        };
        setDraft(savedDraft);
        setDirty(false);
        if (websiteVisual?.logo && websiteVisual.logo === next.logo)
          onWebsiteVisualReviewed?.("logo");
        stageWebsiteLook(next);
        if (websiteCopy) {
          applyWebsiteCopy(websiteCopy, savedDraft);
          onWebsiteCopyReviewed?.();
        }
      } catch {
        setMessage("loadError");
      }
    });
  }

  function stageWebsiteLook(current: Pick<StudioBrandKit, "colors" | "fonts">) {
    if (
      !websiteVisual ||
      (!websiteVisual.colors.length && !websiteVisual.fonts.length)
    )
      return;
    setLookDraft({
      colors: (websiteVisual.colors.length
        ? websiteVisual.colors
        : current.colors
      ).join("\n"),
      fonts: (websiteVisual.fonts.length
        ? websiteVisual.fonts
        : current.fonts
      ).join("\n"),
      websiteColors: websiteVisual.colors,
    });
  }

  function uploadLogo(file: File) {
    if (pending || !kit) return;
    const type = resolveUserUploadContentType(file.name, file.type);
    if (
      !file.size ||
      file.size > ENTITY_IMAGE_MAX_SIZE_BYTES ||
      !type ||
      !isStudioLogoMime(type)
    ) {
      setLogoMessage("logoFileInvalid");
      return;
    }
    startLogoTransition(async () => {
      setLogoMessage(null);
      try {
        const { logo } = await uploadStudioProjectLogo({ projectId, file });
        applyLogo(logo);
      } catch {
        setLogoMessage("logoUploadError");
      }
    });
  }

  function applyLogo(logo: string | null) {
    setKit((current) => (current ? { ...current, logo } : current));
    onLogoChange(logo, kit?.studioLogoPosition ?? null);
    setFoundLogo(null);
    if (websiteVisual?.logo) onWebsiteVisualReviewed?.("logo");
    setLogoMessage("logoSaved");
  }

  function saveLogoPosition() {
    if (pending || !kit?.logo) return;
    startLogoTransition(async () => {
      setLogoMessage(null);
      try {
        const { logo, position } = await saveStudioLogoPosition({
          projectId,
          position: logoPositionDraft,
        });
        setKit({ ...kit, logo, studioLogoPosition: position });
        setLogoPositionDraft(position);
        onLogoChange(logo, position);
        setLogoMessage("logoPositionSaved");
      } catch {
        setLogoMessage("logoPositionError");
      }
    });
  }

  function findWebsiteLogo() {
    if (pending || !websiteUrl) return;
    startWebsiteLogoTransition(async () => {
      setLogoMessage(null);
      try {
        const { logo } = await findStudioWebsiteLogo({ projectId });
        setFoundLogo(logo);
        if (!logo) setLogoMessage("websiteLogoMissing");
      } catch {
        setLogoMessage("websiteLogoError");
      }
    });
  }

  function approveWebsiteLogo() {
    if (pending || !logoCandidate) return;
    startWebsiteLogoTransition(async () => {
      setLogoMessage(null);
      try {
        const { logo } = await saveStudioWebsiteLogo({
          projectId,
          logo: logoCandidate,
        });
        applyLogo(logo);
      } catch {
        setLogoMessage("logoUploadError");
      }
    });
  }

  function update(field: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    if (message !== "conflict") setMessage(null);
  }

  function applyWebsiteCopy(website: StudioWebsiteCopy, current: typeof draft) {
    const approved = lines(current.approvedLines);
    const seen = new Set(approved.map((line) => line.toLowerCase()));
    const additions = website.lines
      .filter((line) => {
        const key = line.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, Math.max(0, MAX_LINES - approved.length));
    const summary = !current.summary.trim() ? website.summary : null;
    const tone = !current.tone.trim() ? website.tone : undefined;
    const audience = !current.audience.trim()
      ? website.audience?.join("\n")
      : undefined;
    if (!summary && !additions.length && !tone && !audience) {
      setWebsiteMessage("websiteCopyEmpty");
      return;
    }
    setDraft({
      ...current,
      summary: summary ?? current.summary,
      tone: tone ?? current.tone,
      audience: audience || current.audience,
      approvedLines: additions.length
        ? [current.approvedLines.trimEnd(), ...additions]
            .filter(Boolean)
            .join("\n")
        : current.approvedLines,
    });
    setDirty(true);
    setWebsiteMessage(
      tone || audience ? "websiteProfileAdded" : "websiteCopyAdded",
    );
    if (message !== "conflict") setMessage(null);
  }

  function addWebsiteCopy() {
    if (pending || !kit) return;
    startWebsiteTransition(async () => {
      setWebsiteMessage(null);
      try {
        applyWebsiteCopy(await getStudioWebsiteCopy({ projectId }), draft);
      } catch {
        setWebsiteMessage("websiteCopyError");
      }
    });
  }

  function save() {
    if (
      !kit ||
      pending ||
      !dirty ||
      !copy.summary ||
      !copy.tone ||
      invalidLines
    )
      return;
    startTransition(async () => {
      try {
        const result = await saveStudioBrandCopy({
          projectId,
          copy,
          version: kit.version,
        });
        if (!result.ok) {
          setMessage(result.conflict ? "conflict" : "saveError");
          return;
        }
        setKit({ ...kit, ...copy, version: result.version });
        setDirty(false);
        setMessage("saved");
      } catch {
        setMessage("saveError");
      }
    });
  }

  function updateLook(next: SaveStudioBrandLook["look"]) {
    if (!kit || pending || (next && invalidLook)) return;
    startLookTransition(async () => {
      try {
        const result = await saveStudioBrandLook({
          projectId,
          look: next,
          lookRevision: kit.lookRevision ?? 0,
        });
        if (!result.ok) {
          setLookMessage(result.conflict ? "lookConflict" : "lookSaveError");
          return;
        }
        setKit((current) => current && { ...current, ...result.look });
        if (reviewsCurrentWebsiteLook) onWebsiteVisualReviewed?.("look");
        setLookDraft(null);
        setLookMessage(next ? "lookSaved" : "lookReset");
      } catch {
        setLookMessage("lookSaveError");
      }
    });
  }

  function reloadLook() {
    startLookTransition(async () => {
      try {
        const { colors, fonts, lookRevision, hasCustomLook } =
          await getStudioBrandKit({ projectId });
        setKit(
          (current) =>
            current && {
              ...current,
              colors,
              fonts,
              lookRevision,
              hasCustomLook,
            },
        );
        setLookDraft(null);
        stageWebsiteLook({ colors, fonts });
        setLookMessage(null);
      } catch {
        setLookMessage("lookConflict");
      }
    });
  }

  const triggerLabel = t(
    websiteVisual
      ? "WebsiteDraft.reviewBrand"
      : websiteCopy
        ? "WebsiteDraft.reviewCopy"
        : "brandKit",
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending || disabled) return;
        setOpen(next);
        if (!next) return;
        if (!dirty && !lookDraft) {
          load();
        } else {
          if (kit && !lookDraft) stageWebsiteLook(kit);
          if (websiteCopy) {
            applyWebsiteCopy(websiteCopy, draft);
            onWebsiteCopyReviewed?.();
          }
        }
      }}
    >
      <StudioToolbarTip label={triggerLabel}>
        <DialogTrigger asChild disabled={disabled}>
          <Button disabled={disabled} size="sm" type="button" variant="outline">
            <Palette aria-hidden />
            <span className={STUDIO_TOOLBAR_LABEL_CLASS}>{triggerLabel}</span>
          </Button>
        </DialogTrigger>
      </StudioToolbarTip>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("brandKit")}</DialogTitle>
          <DialogDescription>{t("BrandKit.description")}</DialogDescription>
        </DialogHeader>
        <div className="app-scrollbar -mx-6 -my-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-1">
          {kit && websiteUrl ? (
            <div className="space-y-2">
              <Button
                disabled={pending}
                loading={websitePending}
                onClick={addWebsiteCopy}
                size="sm"
                type="button"
                variant="outline"
              >
                <Globe aria-hidden />
                {t("BrandKit.addWebsiteCopy")}
              </Button>
              {websiteMessage ? (
                <p role="status" className="text-muted-foreground text-sm">
                  {t(`BrandKit.${websiteMessage}`)}
                </p>
              ) : null}
            </div>
          ) : null}
          {kit ? (
            <fieldset className="min-w-0 space-y-4" disabled={pending}>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {kit.logo ? (
                    <Image
                      alt={t("BrandKit.currentLogo")}
                      className="h-8 w-auto max-w-36 object-contain"
                      height={32}
                      src={kit.logo}
                      unoptimized
                      width={144}
                    />
                  ) : null}
                  <input
                    accept={STUDIO_LOGO_MIME_TYPES.join(",")}
                    aria-label={t("BrandKit.logoFile")}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) uploadLogo(file);
                    }}
                    ref={logoInput}
                    type="file"
                  />
                  <Button
                    loading={logoPending}
                    onClick={() => logoInput.current?.click()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <ImagePlus aria-hidden />
                    {t(
                      kit.logo ? "BrandKit.replaceLogo" : "BrandKit.uploadLogo",
                    )}
                  </Button>
                  {websiteUrl && !logoCandidate ? (
                    <Button
                      loading={websiteLogoPending}
                      onClick={findWebsiteLogo}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Globe aria-hidden />
                      {t("BrandKit.findWebsiteLogo")}
                    </Button>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("BrandKit.logoRequirements")}
                </p>
                {kit.logo ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StudioLogoPositionSelect
                        label={t("BrandKit.logoPosition")}
                        onChange={(position) =>
                          setLogoPositionDraft(position ?? null)
                        }
                        value={logoPositionDraft ?? undefined}
                      />
                      <Button
                        disabled={
                          logoPositionDraft === (kit.studioLogoPosition ?? null)
                        }
                        loading={logoPending}
                        onClick={saveLogoPosition}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t("BrandKit.saveLogoPosition")}
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t("BrandKit.logoPositionHint")}
                    </p>
                  </div>
                ) : null}
                {logoCandidate ? (
                  <div className="border-border space-y-2 rounded-md border p-3">
                    <Image
                      alt={t("BrandKit.websiteLogoPreview")}
                      className="h-14 w-auto max-w-full object-contain"
                      height={56}
                      src={logoCandidate}
                      unoptimized
                      width={160}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        loading={websiteLogoPending}
                        onClick={approveWebsiteLogo}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t("BrandKit.useWebsiteLogo")}
                      </Button>
                      <Button
                        onClick={() => {
                          setFoundLogo(null);
                          if (websiteLogo) onWebsiteVisualReviewed?.("logo");
                          setLogoMessage(null);
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t("BrandKit.discardWebsiteLogo")}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {logoMessage ? (
                  <p role="status" className="text-muted-foreground text-sm">
                    {t(`BrandKit.${logoMessage}`)}
                  </p>
                ) : null}
                {swatches.length ? (
                  <ul
                    aria-hidden={lookDraft ? true : undefined}
                    aria-label={lookDraft ? undefined : t("BrandKit.colors")}
                    className="flex flex-wrap gap-2"
                  >
                    {swatches.map((color) => (
                      <li
                        key={color}
                        className="border-border flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs"
                      >
                        <span
                          aria-hidden
                          className="border-border size-3 rounded-full border"
                          style={{ backgroundColor: color }}
                        />
                        {color}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!lookDraft && kit.fonts.length ? (
                  <p className="text-muted-foreground text-sm break-words">
                    {kit.fonts.join(" · ")}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    aria-expanded={lookDraft !== null}
                    onClick={() => {
                      if (reviewsCurrentWebsiteLook)
                        onWebsiteVisualReviewed?.("look");
                      setLookDraft(
                        lookDraft
                          ? null
                          : {
                              colors: kit.colors.join("\n"),
                              fonts: kit.fonts.join("\n"),
                            },
                      );
                      if (lookMessage !== "lookConflict") setLookMessage(null);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t(
                      lookDraft?.websiteColors
                        ? "BrandKit.discardWebsiteLook"
                        : lookDraft
                          ? "BrandKit.cancelLook"
                          : "BrandKit.editLook",
                    )}
                  </Button>
                  {!lookDraft && kit.hasCustomLook ? (
                    <Button
                      loading={lookPending}
                      disabled={lookMessage === "lookConflict"}
                      onClick={() => updateLook(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("BrandKit.resetLook")}
                    </Button>
                  ) : null}
                </div>
                {lookDraft ? (
                  <div className="space-y-2">
                    {lookDraft.websiteColors ? (
                      <p className="text-muted-foreground text-sm">
                        {t("BrandKit.websiteLookDraft")}
                      </p>
                    ) : null}
                    <div className="space-y-1.5">
                      <Label htmlFor="studio-brand-colors">
                        {t("BrandKit.colors")}
                      </Label>
                      <Textarea
                        id="studio-brand-colors"
                        aria-describedby="studio-brand-colors-help"
                        aria-invalid={!!invalidColors}
                        className="font-mono"
                        rows={3}
                        value={lookDraft.colors}
                        onChange={(event) =>
                          setLookDraft({
                            ...lookDraft,
                            colors: event.currentTarget.value,
                          })
                        }
                      />
                      <p
                        id="studio-brand-colors-help"
                        className="text-muted-foreground text-xs"
                      >
                        {t("BrandKit.colorsHelp")}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="studio-brand-fonts">
                        {t("BrandKit.fonts")}
                      </Label>
                      <Textarea
                        id="studio-brand-fonts"
                        aria-describedby="studio-brand-fonts-help"
                        aria-invalid={!!invalidFonts}
                        rows={2}
                        value={lookDraft.fonts}
                        onChange={(event) =>
                          setLookDraft({
                            ...lookDraft,
                            fonts: event.currentTarget.value,
                          })
                        }
                      />
                      <p
                        id="studio-brand-fonts-help"
                        className="text-muted-foreground text-xs"
                      >
                        {t("BrandKit.fontsHelp")}
                      </p>
                    </div>
                    <Button
                      disabled={invalidLook || lookMessage === "lookConflict"}
                      loading={lookPending}
                      onClick={() => updateLook(look)}
                      size="sm"
                      type="button"
                    >
                      {t("BrandKit.saveLook")}
                    </Button>
                  </div>
                ) : null}
                {lookMessage ? (
                  <p role="status" className="text-muted-foreground text-sm">
                    {t(`BrandKit.${lookMessage}`)}
                  </p>
                ) : null}
                {lookMessage === "lookConflict" ? (
                  <Button
                    loading={lookPending}
                    onClick={reloadLook}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t("BrandKit.reloadLook")}
                  </Button>
                ) : null}
                {websiteUrl && !lookDraft ? (
                  <div className="space-y-2">
                    <DesignMdGenerateDialog
                      owner={{ type: "project", projectId }}
                      websiteUrl={websiteUrl}
                      trigger={
                        <Button size="sm" type="button" variant="outline">
                          <WandSparkles aria-hidden />
                          {t("BrandKit.extractWebsiteStyle")}
                        </Button>
                      }
                      onGenerated={({ look }) => {
                        if (!look) return;
                        setKit((current) =>
                          current && !current.hasCustomLook
                            ? {
                                ...current,
                                colors: look.colors,
                                fonts: look.fonts,
                              }
                            : current,
                        );
                        setWebsiteStyleSaved(true);
                      }}
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("BrandKit.websiteStyleHelp")}
                    </p>
                    {websiteStyleSaved ? (
                      <p
                        role="status"
                        className="text-muted-foreground text-sm"
                      >
                        {t("BrandKit.websiteStyleSaved")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="studio-brand-summary">
                  {t("BrandKit.summary")}
                </Label>
                <Textarea
                  id="studio-brand-summary"
                  maxLength={MAX_COPY_LENGTH}
                  value={draft.summary}
                  onChange={(event) =>
                    update("summary", event.currentTarget.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="studio-brand-tone">{t("BrandKit.tone")}</Label>
                <Input
                  id="studio-brand-tone"
                  maxLength={MAX_AUDIENCE_LENGTH}
                  value={draft.tone}
                  onChange={(event) =>
                    update("tone", event.currentTarget.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="studio-brand-audience">
                  {t("BrandKit.audience")}
                </Label>
                <Textarea
                  id="studio-brand-audience"
                  placeholder={t("BrandKit.onePerLine")}
                  value={draft.audience}
                  onChange={(event) =>
                    update("audience", event.currentTarget.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="studio-brand-copy">
                  {t("BrandKit.approvedLines")}
                </Label>
                <Textarea
                  id="studio-brand-copy"
                  placeholder={t("BrandKit.onePerLine")}
                  value={draft.approvedLines}
                  onChange={(event) =>
                    update("approvedLines", event.currentTarget.value)
                  }
                />
              </div>
            </fieldset>
          ) : pending ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("BrandKit.loading")}
            </p>
          ) : null}
          {invalidLines ? (
            <p role="alert" className="text-muted-foreground text-sm">
              {t("BrandKit.lineLimits")}
            </p>
          ) : null}
          {message ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t(`BrandKit.${message}`)}
            </p>
          ) : null}
          {message === "conflict" || message === "loadError" ? (
            <Button
              disabled={pending}
              onClick={load}
              type="button"
              size="sm"
              variant="outline"
            >
              {t("BrandKit.reload")}
            </Button>
          ) : null}
        </div>
        <DialogFooter>
          <Button asChild variant="outline">
            <Link
              href={`/projects/${encodeURIComponent(projectId)}/design-md`}
              aria-label={t("brandKitNewTab")}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("BrandKit.editDesign")}
              <ExternalLink aria-hidden />
            </Link>
          </Button>
          <Button
            disabled={pending}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {t("BrandKit.close")}
          </Button>
          {kit ? (
            <Button
              disabled={
                pending ||
                !dirty ||
                !copy.summary ||
                !copy.tone ||
                invalidLines ||
                message === "conflict"
              }
              loading={brandPending}
              onClick={save}
              type="button"
            >
              {t("BrandKit.save")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
