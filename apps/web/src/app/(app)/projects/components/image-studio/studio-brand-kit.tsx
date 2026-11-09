import type {
  StudioBrandCopy,
  StudioBrandKit,
  StudioWebsiteCopy,
} from "@sokosumi/core-client";
import {
  ENTITY_IMAGE_MAX_SIZE_BYTES,
  isStudioLogoMime,
  resolveUserUploadContentType,
  STUDIO_LOGO_MIME_TYPES,
} from "@sokosumi/utils";
import { ExternalLink, Globe, ImagePlus, Palette } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
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
  getStudioBrandKit,
  getStudioWebsiteCopy,
  saveStudioBrandCopy,
  uploadStudioProjectLogo,
} from "@/lib/actions/image-studio/brand-kit";

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
  hasWebsite = false,
  onLogoChange,
  onWebsiteCopyReviewed,
  projectId,
  websiteCopy,
}: {
  disabled?: boolean;
  hasWebsite?: boolean;
  onLogoChange: (logo: string | null) => void;
  onWebsiteCopyReviewed?: () => void;
  projectId: string;
  websiteCopy?: StudioWebsiteCopy | null;
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
  const [message, setMessage] = useState<
    "saved" | "loadError" | "saveError" | "conflict" | null
  >(null);
  const [brandPending, startTransition] = useTransition();
  const [logoPending, startLogoTransition] = useTransition();
  const [websitePending, startWebsiteTransition] = useTransition();
  const pending = brandPending || logoPending || websitePending;
  const logoInput = useRef<HTMLInputElement>(null);
  const [logoMessage, setLogoMessage] = useState<
    "logoSaved" | "logoUploadError" | "logoFileInvalid" | null
  >(null);
  const [websiteMessage, setWebsiteMessage] = useState<
    "websiteCopyAdded" | "websiteCopyEmpty" | "websiteCopyError" | null
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

  function load() {
    startTransition(async () => {
      setMessage(null);
      setLogoMessage(null);
      setWebsiteMessage(null);
      try {
        const next = await getStudioBrandKit({ projectId });
        setKit(next);
        onLogoChange(next.logo);
        const savedDraft = {
          summary: next.summary,
          tone: next.tone,
          audience: next.audience.join("\n"),
          approvedLines: next.approvedLines.join("\n"),
        };
        setDraft(savedDraft);
        setDirty(false);
        if (websiteCopy) {
          applyWebsiteCopy(websiteCopy, savedDraft);
          onWebsiteCopyReviewed?.();
        }
      } catch {
        setMessage("loadError");
      }
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
        setKit((current) => (current ? { ...current, logo } : current));
        onLogoChange(logo);
        setLogoMessage("logoSaved");
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
    if (!summary && !additions.length) {
      setWebsiteMessage("websiteCopyEmpty");
      return;
    }
    setDraft({
      ...current,
      summary: summary ?? current.summary,
      approvedLines: additions.length
        ? [current.approvedLines.trimEnd(), ...additions]
            .filter(Boolean)
            .join("\n")
        : current.approvedLines,
    });
    setDirty(true);
    setWebsiteMessage("websiteCopyAdded");
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending || disabled) return;
        setOpen(next);
        if (!next) return;
        if (!dirty) {
          load();
        } else if (websiteCopy) {
          applyWebsiteCopy(websiteCopy, draft);
          onWebsiteCopyReviewed?.();
        }
      }}
    >
      <DialogTrigger asChild disabled={disabled}>
        <Button disabled={disabled} size="sm" type="button" variant="outline">
          <Palette aria-hidden />
          {t(websiteCopy ? "WebsiteDraft.reviewCopy" : "brandKit")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="app-scrollbar max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("brandKit")}</DialogTitle>
          <DialogDescription>{t("BrandKit.description")}</DialogDescription>
        </DialogHeader>
        {kit && hasWebsite ? (
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
                  <ProjectAvatar logo={kit.logo} name={t("brandKit")} />
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
                  {t(kit.logo ? "BrandKit.replaceLogo" : "BrandKit.uploadLogo")}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("BrandKit.logoRequirements")}
              </p>
              {logoMessage ? (
                <p role="status" className="text-muted-foreground text-sm">
                  {t(`BrandKit.${logoMessage}`)}
                </p>
              ) : null}
              {kit.colors.length ? (
                <ul
                  aria-label={t("BrandKit.colors")}
                  className="flex flex-wrap gap-2"
                >
                  {kit.colors.map((color) => (
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
              {kit.fonts.length ? (
                <p className="text-muted-foreground text-sm break-words">
                  {kit.fonts.join(" · ")}
                </p>
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
                onChange={(event) => update("tone", event.currentTarget.value)}
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
