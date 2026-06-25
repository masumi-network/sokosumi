"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  buildUserMetadataWithDesignMd,
  buildUserMetadataWithUrl,
  getUserMetadata,
  normalizeOrganizationLogo,
  parseUserMetadata,
  serializeMetadataRecord,
} from "@sokosumi/utils";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  DesignMdProfileSection,
  type DesignMdProfileValue,
} from "@/components/design-md";
import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/auth.client";
import {
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
} from "@/lib/constants/organization-logo";
import {
  type BrandProfileFormType,
  brandProfileFormSchema,
} from "@/lib/schemas";
import { formatBytes } from "@/lib/utils/format-bytes";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

interface BrandProfileSectionProps {
  designMdValue?: DesignMdProfileValue;
  logo?: null | string;
  metadata?: null | string;
}

export function BrandProfileSection({
  designMdValue,
  logo,
  metadata: initialMetadata,
}: BrandProfileSectionProps) {
  const t = useTranslations("App.Account.BrandProfile");
  const schemaT = useTranslations("App.Account.BrandProfile.Schema");
  const router = useRouter();
  const submitInFlightRef = useRef(false);
  const [metadata, setMetadata] = useState<null | string>(
    initialMetadata ?? null,
  );
  const [prevInitialMetadata, setPrevInitialMetadata] =
    useState(initialMetadata);

  if (initialMetadata !== prevInitialMetadata) {
    setPrevInitialMetadata(initialMetadata);
    setMetadata(initialMetadata ?? null);
  }

  const [pendingLogoFiles, setPendingLogoFiles] = useState<File[]>([]);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = useState(false);

  const userMetadata = getUserMetadata(metadata);
  const websiteUrl = userMetadata.url ?? "";

  const form = useForm<BrandProfileFormType>({
    resolver: zodResolver(brandProfileFormSchema(schemaT)),
    defaultValues: {
      logo: logo ?? "",
      websiteUrl,
    },
  });

  const logoValue = useWatch({
    control: form.control,
    name: "logo",
  });
  const formWebsiteUrl = useWatch({
    control: form.control,
    name: "websiteUrl",
  });

  const isBusy =
    form.formState.isSubmitting || isUploadingLogo || isRemovingLogo;

  const logoLabels = {
    fileTooLarge: t("fileTooLarge"),
    fileTypeNotAccepted: t("fileTypeNotAccepted"),
    maxFilesExceeded: t("maxFilesExceeded"),
    previewAlt: t("logoPreviewAlt"),
    remove: t("logoRemove"),
    replace: t("logoReplace"),
    upload: t("logoUpload"),
    uploadError: t("logoUploadError"),
  };

  const persistLogo = useCallback(
    async (nextLogo: string) => {
      const result = await authClient.updateUser({
        logo: nextLogo,
      });

      if (result.error) {
        throw new Error(result.error.message ?? t("logoSaveError"));
      }

      form.setValue("logo", nextLogo, { shouldDirty: false });
      router.refresh();
    },
    [form, router, t],
  );

  const handleLogoUpload = useCallback(
    async (files: File[]) => {
      const logoFile = files[0];
      if (!logoFile) return;

      setIsUploadingLogo(true);
      try {
        const uploadedFile = await raceWithTimeout(
          uploadUserFileDirect(logoFile, {
            allowedContentTypes: [...ORGANIZATION_LOGO_ALLOWED_MIME_TYPES],
            maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
          }),
          ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
        );
        const nextLogo =
          normalizeOrganizationLogo(uploadedFile.publicUrl) ?? "";
        await persistLogo(nextLogo);
        toast.success(t("logoUploadSuccess"));
      } catch (error) {
        toast.error(
          error instanceof ClientTimeoutError
            ? t("logoUploadError")
            : getUserFileUploadErrorMessage(error, t("logoUploadError")),
        );
      } finally {
        setPendingLogoFiles([]);
        setIsUploadingLogo(false);
      }
    },
    [persistLogo, t],
  );

  const handleRemoveLogo = useCallback(async () => {
    setIsRemovingLogo(true);
    try {
      await persistLogo("");
      setPendingLogoFiles([]);
      toast.success(t("logoRemoveSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("logoRemoveError"),
      );
    } finally {
      setIsRemovingLogo(false);
    }
  }, [persistLogo, t]);

  const handleSubmit = async (values: BrandProfileFormType) => {
    if (submitInFlightRef.current) return;

    submitInFlightRef.current = true;
    try {
      const nextMetadata = buildUserMetadataWithUrl(
        parseUserMetadata(metadata),
        values.websiteUrl,
      );
      const serializedMetadata = serializeMetadataRecord(nextMetadata);
      const result = await authClient.updateUser({
        metadata: serializedMetadata,
      });

      if (result.error) {
        toast.error(result.error.message ?? t("saveError"));
        return;
      }

      setMetadata(serializedMetadata);
      form.reset({
        logo: form.getValues("logo") ?? "",
        websiteUrl: getUserMetadata(serializedMetadata).url ?? "",
      });
      toast.success(t("saveSuccess"));
      router.refresh();
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const handleDesignMdChange = useCallback((value?: DesignMdProfileValue) => {
    setMetadata((currentMetadata) => {
      const nextMetadata = buildUserMetadataWithDesignMd(
        parseUserMetadata(currentMetadata),
        {
          extractionId: value?.extractionId ?? null,
          url: value?.url ?? null,
        },
      );

      return serializeMetadataRecord(nextMetadata);
    });
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <fieldset disabled={isBusy}>
              <CardHeader>
                <CardTitle>{t("title")}</CardTitle>
                <CardDescription>{t("description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="logo"
                  render={() => (
                    <FormItem>
                      <FormLabel>{t("logoLabel")}</FormLabel>
                      <FormControl>
                        <OrganizationLogoUploadField
                          disabled={isBusy}
                          isRemoving={isRemovingLogo}
                          isUploading={isUploadingLogo}
                          labels={logoLabels}
                          logoValue={logoValue ?? ""}
                          onPendingLogoFilesChange={setPendingLogoFiles}
                          onRemove={() => {
                            void handleRemoveLogo();
                          }}
                          onUpload={handleLogoUpload}
                          pendingLogoFiles={pendingLogoFiles}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("logoDescription", {
                          maxSize: formatBytes(
                            ORGANIZATION_LOGO_MAX_SIZE_BYTES,
                          ),
                        })}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="websiteUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("websiteLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder={t("websitePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("websiteDescription")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter>
                <Button
                  type="submit"
                  disabled={isBusy || !form.formState.isDirty}
                  className="w-full"
                >
                  {form.formState.isSubmitting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {form.formState.isSubmitting ? t("saving") : t("submit")}
                </Button>
              </CardFooter>
            </fieldset>
          </form>
        </Form>
      </Card>

      <DesignMdProfileSection
        editHref="/account/design-md/edit"
        owner={{ type: "user" }}
        value={designMdValue}
        websiteUrl={formWebsiteUrl}
        onValueChange={handleDesignMdChange}
      />
    </div>
  );
}
