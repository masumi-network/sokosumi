import type { ProjectImageStudioTalkingVideoCatalog } from "@sokosumi/core-client";
import { LoaderCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { RadioGroup } from "radix-ui";
import { type ReactNode, useId, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Languages the voices speak well; the reader's own comes first. */
export const SCRIPT_LANGUAGES = [
  "en",
  "de",
  "es",
  "fr",
  "it",
  "pt",
  "nl",
] as const;
export const OWN_PHOTO = "own-photo";

export type PresenterPhoto = {
  id: string;
  name: string;
  /** A local preview of the file just uploaded. */
  previewUrl: string;
};

export function PresenterControls({
  catalog,
  presenterId,
  photo,
  consent,
  voice,
  languageCode,
  languageNames,
  readOnly,
  uploading,
  problem,
  onPresenterChange,
  onConsentChange,
  onPhoto,
  onVoiceChange,
  onLanguageChange,
}: {
  catalog: ProjectImageStudioTalkingVideoCatalog;
  presenterId: string;
  photo: PresenterPhoto | null;
  consent: boolean;
  voice: string;
  languageCode: string;
  languageNames: Intl.DisplayNames;
  readOnly: boolean;
  uploading: boolean;
  problem: ReactNode;
  onPresenterChange: (id: string) => void;
  onConsentChange: (checked: boolean) => void;
  onPhoto: (file: File) => void;
  onVoiceChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
}) {
  const t = useTranslations("App.TikTokStudio");
  const ownPhoto = presenterId === OWN_PHOTO;
  const voiceId = useId();
  const languageId = useId();
  const consentId = useId();
  const photoInput = useRef<HTMLInputElement>(null);
  const tileClass = (selected: boolean) =>
    cn(
      "bg-muted relative flex aspect-9/16 w-full items-center justify-center overflow-hidden rounded-lg border-2",
      selected ? "border-foreground" : "border-transparent",
    );
  return (
    <>
      <RadioGroup.Root
        aria-label={t("presenter")}
        className="grid grid-cols-5 gap-2 sm:grid-cols-10"
        disabled={readOnly}
        onValueChange={onPresenterChange}
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
              <PresenterImage src={presenter.imageUrl} />
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
                <Upload aria-hidden className="text-muted-foreground size-5" />
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
          if (file) void onPhoto(file);
        }}
        ref={photoInput}
        type="file"
      />
      {problem}
      {ownPhoto && photo ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <Checkbox
              checked={consent}
              className="mt-0.5"
              id={consentId}
              onCheckedChange={(checked) => onConsentChange(checked === true)}
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
        <p className="text-muted-foreground text-xs">{t("presenterNote")}</p>
      )}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={voiceId}>{t("voice")}</Label>
          <Select
            disabled={readOnly}
            onValueChange={onVoiceChange}
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
            onValueChange={onLanguageChange}
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
    </>
  );
}

/** A presenter photo that pulses until it has loaded, then fades in. */
function PresenterImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {loaded ? null : (
        <Skeleton aria-hidden className="absolute inset-0 rounded-none" />
      )}
      <img
        alt=""
        className={cn(
          "size-full object-cover transition-opacity duration-300 motion-reduce:transition-none",
          loaded ? "opacity-100" : "opacity-0",
        )}
        height={160}
        loading="lazy"
        onError={() => setLoaded(true)}
        onLoad={() => setLoaded(true)}
        // A cached image can finish before hydration attaches onLoad.
        ref={(img) => {
          if (img?.complete) setLoaded(true);
        }}
        src={src}
        width={90}
      />
    </>
  );
}
