"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { OrganizationRecord } from "@sokosumi/core-client";
import {
  buildOrganizationMetadataWithUrl,
  getOrganizationMetadata,
  normalizeOrganizationLogo,
  normalizeWebsiteUrl,
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  parseOrganizationMetadata,
} from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { authClient } from "@/lib/auth/auth.client";
import { ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS } from "@/lib/constants/organization-logo";
import {
  type OrganizationInformationFormSchemaType,
  organizationInformationFormSchema,
} from "@/lib/schemas/organization";
import {
  cleanupOrganizationLogoBestEffort,
  getOrganizationLogoUploadErrorMessage,
  uploadOrganizationLogoDirect,
} from "@/lib/utils/organization-logo-upload.client";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";

import { organizationInformationFormData } from "./data";
import { FormFields } from "./form-fields";

interface OrganizationInformationFormProps {
  organization: OrganizationRecord;
  organizationMetadata?: string | null;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onLogoUploadBusyChange?: (busy: boolean) => void;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export default function OrganizationInformationForm({
  organization,
  organizationMetadata,
  setIsLoading,
  onLogoUploadBusyChange,
  onOpenChange,
}: OrganizationInformationFormProps) {
  const t = useTranslations("Components.Organizations.InformationModal.Form");
  const router = useRouter();
  const submitInFlightRef = useRef(false);
  const logoAtOpenRef = useRef(organization.logo ?? "");
  const [pendingLogoFiles, setPendingLogoFiles] = useState<File[]>([]);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const form = useForm<OrganizationInformationFormSchemaType>({
    resolver: zodResolver(
      organizationInformationFormSchema(
        useTranslations("Components.Organizations.InformationModal.Schema"),
      ),
    ),
    defaultValues: {
      name: organization.name,
      logo: organization.logo ?? "",
      url: getOrganizationMetadata(organization.metadata).url ?? "",
      metadata: parseOrganizationMetadata(organization.metadata),
    },
  });

  const logoValue = useWatch({
    control: form.control,
    name: "logo",
  });

  const handleLogoUpload = useCallback(
    async (files: File[]) => {
      const logoFile = files[0];
      if (!logoFile) return;

      setIsUploadingLogo(true);
      onLogoUploadBusyChange?.(true);
      try {
        const uploadedFile = await raceWithTimeout(
          uploadOrganizationLogoDirect(organization.id, logoFile, {
            allowedContentTypes: [...ORGANIZATION_LOGO_ALLOWED_MIME_TYPES],
            maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
          }),
          ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
        );
        form.setValue("logo", uploadedFile.publicUrl, { shouldDirty: true });
      } catch (error) {
        toast.error(
          error instanceof ClientTimeoutError
            ? t("Fields.Logo.uploadError")
            : getOrganizationLogoUploadErrorMessage(
                error,
                t("Fields.Logo.uploadError"),
              ),
        );
      } finally {
        setPendingLogoFiles([]);
        setIsUploadingLogo(false);
        onLogoUploadBusyChange?.(false);
      }
    },
    [form, onLogoUploadBusyChange, organization, t],
  );

  const handleRemoveLogo = useCallback(() => {
    form.setValue("logo", "", { shouldDirty: true });
    setPendingLogoFiles([]);
  }, [form]);

  const onSubmit = async (values: OrganizationInformationFormSchemaType) => {
    if (submitInFlightRef.current) {
      return;
    }
    submitInFlightRef.current = true;
    setIsLoading(true);
    try {
      const previousPersistedLogo = logoAtOpenRef.current;
      // The logo uploads on pick, so the form holds its URL; replacing it
      // before saving must not wipe it to "".
      const logoForApi = normalizeOrganizationLogo(values.logo);

      const metadataSource =
        organizationMetadata ?? organization.metadata ?? values.metadata;
      const websiteUrl =
        values.url?.trim() && values.url.trim().length > 0
          ? (normalizeWebsiteUrl(values.url) ?? "")
          : "";
      const metadataForApi = buildOrganizationMetadataWithUrl(
        parseOrganizationMetadata(metadataSource),
        websiteUrl,
      );

      const result = await authClient.organization.update({
        organizationId: organization.id,
        data: {
          name: values.name,
          metadata: metadataForApi ?? undefined,
          // null clears; never coerce to "" (Better Auth accepts nullish).
          logo: logoForApi,
        },
      });

      if (result.error) {
        const errorMessage = result.error.message ?? t("Error.edit");
        if (result.error.status === 401) {
          toast.error(errorMessage, {
            action: {
              label: t("Errors.unauthorizedAction"),
              onClick: async () => {
                router.push("/signin");
              },
            },
          });
        } else {
          toast.error(errorMessage);
        }
        return;
      }

      if (
        previousPersistedLogo &&
        (logoForApi ?? null) !== previousPersistedLogo
      ) {
        void cleanupOrganizationLogoBestEffort(
          organization.id,
          previousPersistedLogo,
        );
      }

      toast.success(t("Success.edit"));
      router.refresh();
      onOpenChange(false);
    } finally {
      submitInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const isLoading = form.formState.isSubmitting || isUploadingLogo;
  const logoLabels = {
    fileTooLarge: t("Fields.Logo.fileTooLarge"),
    fileTypeNotAccepted: t("Fields.Logo.fileTypeNotAccepted"),
    maxFilesExceeded: t("Fields.Logo.maxFilesExceeded"),
    previewAlt: t("Fields.Logo.previewAlt"),
    remove: t("Fields.Logo.remove"),
    replace: t("Fields.Logo.replace"),
    upload: t("Fields.Logo.upload"),
    uploadError: t("Fields.Logo.uploadError"),
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-8"
      >
        <fieldset disabled={isLoading} className="flex flex-col gap-8">
          <FormField
            control={form.control}
            name="logo"
            render={() => (
              <FormItem>
                <FormLabel>{t("Fields.Logo.label")}</FormLabel>
                <FormControl>
                  <OrganizationLogoUploadField
                    disabled={isLoading}
                    isUploading={isUploadingLogo}
                    labels={logoLabels}
                    logoValue={logoValue ?? ""}
                    onPendingLogoFilesChange={setPendingLogoFiles}
                    onRemove={handleRemoveLogo}
                    onUpload={handleLogoUpload}
                    pendingLogoFiles={pendingLogoFiles}
                  />
                </FormControl>
                <FormDescription>
                  {t("Fields.Logo.description")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormFields form={form} formData={organizationInformationFormData} />
        </fieldset>
        {/* Outside the fieldset: a disabled fieldset would natively
            disable the button and fade its loading bar. */}
        <Button type="submit" className="w-full" loading={isLoading}>
          {t("Submit.edit")}
        </Button>
      </form>
    </Form>
  );
}
