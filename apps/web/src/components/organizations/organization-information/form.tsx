"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  buildOrganizationMetadataWithUrl,
  getOrganizationMetadata,
  normalizeOrganizationLogo,
  normalizeWebsiteUrl,
  parseOrganizationMetadata,
} from "@sokosumi/utils";
import { Loader2 } from "lucide-react";
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
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
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
import { generateOrganizationSlug } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import type { OrganizationRecord } from "@/lib/clients/generated/core";
import {
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
} from "@/lib/constants/organization-logo";
import {
  type OrganizationInformationFormSchemaType,
  organizationInformationFormSchema,
} from "@/lib/schemas";
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
  organization: OrganizationRecord | null;
  organizationMetadata?: string | null;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onLogoUploadBusyChange?: (busy: boolean) => void;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

function isBlobPreviewUrl(url: string | null | undefined): boolean {
  return Boolean(url?.startsWith("blob:"));
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
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const submitInFlightRef = useRef(false);
  const logoObjectUrlRef = useRef<string | null>(null);
  const logoAtOpenRef = useRef(organization?.logo ?? "");
  const [pendingLogoFiles, setPendingLogoFiles] = useState<File[]>([]);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const form = useForm<OrganizationInformationFormSchemaType>({
    resolver: zodResolver(
      organizationInformationFormSchema(
        useTranslations("Components.Organizations.InformationModal.Schema"),
      ),
    ),
    defaultValues: {
      name: organization?.name ?? "",
      logo: organization?.logo ?? "",
      url: getOrganizationMetadata(organization?.metadata).url ?? "",
      metadata: parseOrganizationMetadata(organization?.metadata),
    },
  });

  const logoValue = useWatch({
    control: form.control,
    name: "logo",
  });

  const revokeLogoObjectUrl = useCallback(() => {
    if (logoObjectUrlRef.current) {
      URL.revokeObjectURL(logoObjectUrlRef.current);
      logoObjectUrlRef.current = null;
    }
  }, []);

  const handleLogoUpload = useCallback(
    async (files: File[]) => {
      const logoFile = files[0];
      if (!logoFile) return;

      // Create flow: hold File until org exists — never mint under user prefix.
      if (!organization) {
        revokeLogoObjectUrl();
        const previewUrl = URL.createObjectURL(logoFile);
        logoObjectUrlRef.current = previewUrl;
        form.setValue("logo", previewUrl, { shouldDirty: true });
        return;
      }

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
    [form, onLogoUploadBusyChange, organization, revokeLogoObjectUrl, t],
  );

  const handleRemoveLogo = useCallback(() => {
    revokeLogoObjectUrl();
    form.setValue("logo", "", { shouldDirty: true });
    setPendingLogoFiles([]);
  }, [form, revokeLogoObjectUrl]);

  const onSubmit = async (values: OrganizationInformationFormSchemaType) => {
    if (submitInFlightRef.current) {
      return;
    }
    submitInFlightRef.current = true;
    setIsLoading(true);
    try {
      let result;
      const isCreating = !organization;
      const pendingLogoFile = pendingLogoFiles[0];
      const previousPersistedLogo = logoAtOpenRef.current;

      // Create may hold a File / blob: preview until the org exists — never
      // mint under the user prefix. Edit uploads immediately, so prefer the
      // form URL even if FileUpload still reports a pending file (replace
      // before save must not wipe logo to "").
      const logoForApi =
        isCreating && (pendingLogoFile || isBlobPreviewUrl(values.logo))
          ? null
          : normalizeOrganizationLogo(values.logo);

      const metadataSource =
        organizationMetadata ?? organization?.metadata ?? values.metadata;
      const websiteUrl =
        values.url?.trim() && values.url.trim().length > 0
          ? (normalizeWebsiteUrl(values.url) ?? "")
          : "";
      const metadataForApi = buildOrganizationMetadataWithUrl(
        parseOrganizationMetadata(metadataSource),
        websiteUrl,
      );

      if (isCreating) {
        const slugResult = await generateOrganizationSlug({
          name: values.name,
          metadata: values.metadata ?? {
            url: values.url ?? null,
          },
          logo: logoForApi ?? "",
        });

        if (!slugResult.ok) {
          toast.error(t("Error.create"));
          return;
        }

        const slug = slugResult.data;
        result = await authClient.organization.create({
          slug,
          name: values.name,
          ...(metadataForApi && { metadata: metadataForApi }),
          ...(logoForApi && { logo: logoForApi }),
        });
      } else {
        result = await authClient.organization.update({
          organizationId: organization.id,
          data: {
            name: values.name,
            metadata: metadataForApi ?? undefined,
            // null clears; never coerce to "" (Better Auth accepts nullish).
            logo: logoForApi,
          },
        });
      }

      if (result.error) {
        const errorMessage =
          result.error.message ??
          (isCreating ? t("Error.create") : t("Error.edit"));
        if (result.error.status === 401) {
          toast.error(errorMessage, {
            action: {
              label: t("Errors.unauthorizedAction"),
              onClick: async () => {
                router.push("/login");
              },
            },
          });
        } else {
          toast.error(errorMessage);
        }
      } else {
        // After create: mint held File under the new org id, then persist logo.
        if (isCreating && pendingLogoFile && result.data?.id) {
          try {
            const uploaded = await raceWithTimeout(
              uploadOrganizationLogoDirect(result.data.id, pendingLogoFile, {
                allowedContentTypes: [...ORGANIZATION_LOGO_ALLOWED_MIME_TYPES],
                maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
              }),
              ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
            );
            await authClient.organization.update({
              organizationId: result.data.id,
              data: { logo: uploaded.publicUrl },
            });
            revokeLogoObjectUrl();
          } catch (error) {
            toast.error(
              error instanceof ClientTimeoutError
                ? t("Fields.Logo.uploadError")
                : getOrganizationLogoUploadErrorMessage(
                    error,
                    t("Fields.Logo.uploadError"),
                  ),
            );
            // Org was created; still close and switch workspace below.
          }
        } else if (
          !isCreating &&
          organization &&
          previousPersistedLogo &&
          (logoForApi ?? null) !== previousPersistedLogo
        ) {
          void cleanupOrganizationLogoBestEffort(
            organization.id,
            previousPersistedLogo,
          );
        }

        toast.success(isCreating ? t("Success.create") : t("Success.edit"));

        if (isCreating) {
          handleSelectWorkspace(result.data.id, {
            shouldRedirectAgentJobsBasePath: false,
          });
        } else {
          router.refresh();
        }

        onOpenChange(false);
      }
    } finally {
      submitInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const isCreating = !organization;
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
      <form onSubmit={form.handleSubmit(onSubmit)}>
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
          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isCreating ? t("Submit.create") : t("Submit.edit")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
