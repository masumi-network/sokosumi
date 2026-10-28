import type { SocialPostMediaRef } from "@sokosumi/core-client";
import { ImagePlus, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";

/** The same attachments and picker controls for the main post and replies. */
export function SocialPostComposerMedia({
  media,
  disabled,
  uploading,
  onPick,
  onUpload,
  onRemove,
  children,
}: {
  media: SocialPostMediaRef[];
  disabled: boolean;
  uploading: boolean;
  onPick: () => void;
  onUpload: () => void;
  onRemove: (pathname: string) => void;
  children?: ReactNode;
}) {
  const t = useTranslations("App.Projects.SocialPosts");
  return (
    <>
      {media.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="social-post-media"
        >
          {media.map((ref) => (
            <FileChipMiniPreview
              key={ref.pathname}
              fileName={ref.name}
              mediaType={ref.mimeType}
              onRemove={disabled ? undefined : () => onRemove(ref.pathname)}
              removeLabel={t("composer.media.remove", { name: ref.name })}
              size={ref.size}
              sizeClass="size-16"
              url={ref.fileUrl}
            />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-11 md:h-8"
          disabled={disabled}
          onClick={onPick}
        >
          <ImagePlus className="size-4" />
          {t("composer.media.addFromDrive")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-11 md:h-8"
          disabled={disabled}
          loading={uploading}
          onClick={onUpload}
        >
          <Upload className="size-4" />
          {t("composer.media.upload")}
        </Button>
        {children}
      </div>
    </>
  );
}
