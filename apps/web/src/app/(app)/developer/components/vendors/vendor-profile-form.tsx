"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { VendorMembership } from "@/lib/clients/generated/core";
import {
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
} from "@/lib/constants/organization-logo";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

const vendorProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string(),
  logos: z.object({
    light: z.string().nullable(),
    dark: z.string().nullable(),
  }),
});

type VendorProfileFormValues = z.infer<typeof vendorProfileSchema>;

interface VendorProfileFormProps {
  vendor: VendorMembership;
  isSaving: boolean;
  onSave: (values: VendorProfileFormValues) => void;
}

export function VendorProfileForm({
  vendor,
  isSaving,
  onSave,
}: VendorProfileFormProps) {
  const t = useTranslations("App.Developer.Vendors.profile");
  const tLogo = useTranslations("App.Developer.Vendors.profile.logos");
  const submitInFlightRef = useRef(false);
  const [pendingLightLogoFiles, setPendingLightLogoFiles] = useState<File[]>(
    [],
  );
  const [pendingDarkLogoFiles, setPendingDarkLogoFiles] = useState<File[]>([]);
  const [isUploadingLightLogo, setIsUploadingLightLogo] = useState(false);
  const [isUploadingDarkLogo, setIsUploadingDarkLogo] = useState(false);

  const form = useForm<VendorProfileFormValues>({
    resolver: zodResolver(vendorProfileSchema),
    defaultValues: {
      name: vendor.name,
      slug: vendor.slug,
      logos: {
        light: vendor.logos.light,
        dark: vendor.logos.dark,
      },
    },
  });

  const lightLogoValue = useWatch({
    control: form.control,
    name: "logos.light",
  });
  const darkLogoValue = useWatch({
    control: form.control,
    name: "logos.dark",
  });

  const logoLabels = {
    fileTooLarge: tLogo("fileTooLarge"),
    fileTypeNotAccepted: tLogo("fileTypeNotAccepted"),
    maxFilesExceeded: tLogo("maxFilesExceeded"),
    previewAlt: tLogo("previewAlt"),
    remove: tLogo("remove"),
    replace: tLogo("replace"),
    upload: tLogo("upload"),
    uploadError: tLogo("uploadError"),
  };

  const uploadLogo = useCallback(
    async (
      files: File[],
      side: "light" | "dark",
      setUploading: (busy: boolean) => void,
      setPendingFiles: (files: File[]) => void,
    ) => {
      const logoFile = files[0];
      if (!logoFile) {
        return;
      }

      setUploading(true);
      try {
        const uploadedFile = await raceWithTimeout(
          uploadUserFileDirect(logoFile, {
            allowedContentTypes: [...ORGANIZATION_LOGO_ALLOWED_MIME_TYPES],
            maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
          }),
          ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
        );
        form.setValue(`logos.${side}`, uploadedFile.publicUrl, {
          shouldDirty: true,
        });
      } catch (error) {
        toast.error(
          error instanceof ClientTimeoutError
            ? logoLabels.uploadError
            : getUserFileUploadErrorMessage(error, logoLabels.uploadError),
        );
      } finally {
        setPendingFiles([]);
        setUploading(false);
      }
    },
    [form, logoLabels.uploadError],
  );

  const handleSubmit = form.handleSubmit((values) => {
    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    try {
      onSave(values);
    } finally {
      submitInFlightRef.current = false;
    }
  });

  const isDisabled =
    isSaving ||
    isUploadingLightLogo ||
    isUploadingDarkLogo ||
    !form.formState.isDirty;

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("nameLabel")}</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("slugLabel")}</FormLabel>
              <FormControl>
                <Input {...field} readOnly disabled className="bg-muted" />
              </FormControl>
              <p className="text-muted-foreground text-sm">{t("slugHint")}</p>
            </FormItem>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <FormItem>
            <FormLabel>{tLogo("lightLabel")}</FormLabel>
            <OrganizationLogoUploadField
              disabled={isSaving || isUploadingLightLogo}
              isUploading={isUploadingLightLogo}
              labels={logoLabels}
              logoValue={lightLogoValue ?? ""}
              onPendingLogoFilesChange={setPendingLightLogoFiles}
              onUpload={(files) =>
                uploadLogo(
                  files,
                  "light",
                  setIsUploadingLightLogo,
                  setPendingLightLogoFiles,
                )
              }
              onRemove={() =>
                form.setValue("logos.light", null, { shouldDirty: true })
              }
              pendingLogoFiles={pendingLightLogoFiles}
            />
          </FormItem>

          <FormItem>
            <FormLabel>{tLogo("darkLabel")}</FormLabel>
            <OrganizationLogoUploadField
              disabled={isSaving || isUploadingDarkLogo}
              isUploading={isUploadingDarkLogo}
              labels={logoLabels}
              logoValue={darkLogoValue ?? ""}
              onPendingLogoFilesChange={setPendingDarkLogoFiles}
              onUpload={(files) =>
                uploadLogo(
                  files,
                  "dark",
                  setIsUploadingDarkLogo,
                  setPendingDarkLogoFiles,
                )
              }
              onRemove={() =>
                form.setValue("logos.dark", null, { shouldDirty: true })
              }
              pendingLogoFiles={pendingDarkLogoFiles}
            />
          </FormItem>
        </div>

        <Button type="submit" disabled={isDisabled}>
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("save")}
        </Button>
      </form>
    </Form>
  );
}
