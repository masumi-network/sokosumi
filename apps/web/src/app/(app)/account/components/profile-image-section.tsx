"use client";

import { User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth/auth.client";
import {
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
} from "@/lib/constants/organization-logo";
import { formatBytes } from "@/lib/utils/format-bytes";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

interface ProfileImageSectionProps {
  userImage?: null | string;
}

export function ProfileImageSection({ userImage }: ProfileImageSectionProps) {
  const t = useTranslations("App.Account.ProfileImage");
  const router = useRouter();
  const [imageValue, setImageValue] = useState(userImage ?? "");
  const [prevUserImage, setPrevUserImage] = useState(userImage);

  if (userImage !== prevUserImage) {
    setPrevUserImage(userImage);
    setImageValue(userImage ?? "");
  }

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const isBusy = isUploading || isRemoving;

  const labels = {
    fileTooLarge: t("fileTooLarge"),
    fileTypeNotAccepted: t("fileTypeNotAccepted"),
    maxFilesExceeded: t("maxFilesExceeded"),
    previewAlt: t("imagePreviewAlt"),
    remove: t("imageRemove"),
    replace: t("imageReplace"),
    upload: t("imageUpload"),
    uploadError: t("imageUploadError"),
  };

  const persistImage = useCallback(
    async (nextImage: null | string) => {
      const result = await authClient.updateUser({
        image: nextImage,
      });

      if (result.error) {
        throw new Error(result.error.message ?? t("imageSaveError"));
      }

      setImageValue(nextImage ?? "");
      router.refresh();
    },
    [router, t],
  );

  const handleUpload = useCallback(
    async (files: File[]) => {
      const imageFile = files[0];
      if (!imageFile) return;

      setIsUploading(true);
      try {
        const uploadedFile = await raceWithTimeout(
          uploadUserFileDirect(imageFile, {
            allowedContentTypes: [...ORGANIZATION_LOGO_ALLOWED_MIME_TYPES],
            maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
          }),
          ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
        );
        await persistImage(uploadedFile.publicUrl);
        toast.success(t("imageUploadSuccess"));
      } catch (error) {
        toast.error(
          error instanceof ClientTimeoutError
            ? t("imageUploadError")
            : getUserFileUploadErrorMessage(error, t("imageUploadError")),
        );
      } finally {
        setPendingFiles([]);
        setIsUploading(false);
      }
    },
    [persistImage, t],
  );

  const handleRemove = useCallback(async () => {
    setIsRemoving(true);
    try {
      await persistImage(null);
      setPendingFiles([]);
      toast.success(t("imageRemoveSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("imageRemoveError"),
      );
    } finally {
      setIsRemoving(false);
    }
  }, [persistImage, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium">{t("imageLabel")}</p>
        <OrganizationLogoUploadField
          disabled={isBusy}
          fallbackIcon={<User className="size-8" />}
          isRemoving={isRemoving}
          isUploading={isUploading}
          labels={labels}
          logoValue={imageValue}
          onPendingLogoFilesChange={setPendingFiles}
          onRemove={() => {
            void handleRemove();
          }}
          onUpload={handleUpload}
          pendingLogoFiles={pendingFiles}
        />
        <p className="text-muted-foreground text-sm">
          {t("imageDescription", {
            maxSize: formatBytes(ORGANIZATION_LOGO_MAX_SIZE_BYTES),
          })}
        </p>
      </CardContent>
    </Card>
  );
}
