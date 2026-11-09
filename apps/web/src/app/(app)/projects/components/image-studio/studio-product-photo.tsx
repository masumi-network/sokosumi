import { resolveUserUploadContentType } from "@sokosumi/utils";
import { ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";

import type { StudioProductPhoto } from "./types";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_MIB = 12;

export function StudioProductPhotoControl({
  photo,
  uploading,
  onUploadingChange,
  onPhotoChange,
}: {
  photo: StudioProductPhoto | null;
  uploading: boolean;
  onUploadingChange: (uploading: boolean) => void;
  onPhotoChange: (photo: StudioProductPhoto | null) => void;
}) {
  const t = useTranslations("App.Studio");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  async function handlePhoto(file: File) {
    if (uploading || uploadingRef.current) return;
    const mime = resolveUserUploadContentType(file.name, file.type);
    if (!mime || !IMAGE_TYPES.includes(mime) || file.size === 0) {
      toast.error(t("productPhotoType"));
      return;
    }
    if (file.size > MAX_PHOTO_MIB * 1024 * 1024) {
      toast.error(t("productPhotoSize", { size: MAX_PHOTO_MIB }));
      return;
    }

    uploadingRef.current = true;
    onUploadingChange(true);
    try {
      const { data } = await authClient.getSession();
      if (!data) throw new Error("No active session for product photo upload");
      const result = await uploadDriveFile(
        file,
        driveStoreForActiveWorkspace(data.session.activeOrganizationId ?? null),
      );
      if (!result.resourceId) throw new Error("Product photo not finalized");
      onPhotoChange({ id: result.resourceId, name: file.name });
    } catch (error) {
      toast.error(
        isDriveFileUploadDuplicate(error)
          ? t("productPhotoDuplicate")
          : t("productPhotoFailed"),
      );
    } finally {
      uploadingRef.current = false;
      onUploadingChange(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <input
        accept={IMAGE_TYPES.join(",")}
        aria-label={t("productPhoto")}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void handlePhoto(file);
        }}
        ref={inputRef}
        type="file"
      />
      {photo ? (
        <>
          <span
            className="max-w-28 truncate text-xs sm:max-w-40"
            title={photo.name}
          >
            {photo.name}
          </span>
          <Button
            aria-label={t("removeProductPhoto")}
            onClick={() => onPhotoChange(null)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden />
          </Button>
        </>
      ) : (
        <Button
          loading={uploading}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ImagePlus aria-hidden />
          <span className="max-sm:sr-only">{t("addProductPhoto")}</span>
        </Button>
      )}
    </div>
  );
}
