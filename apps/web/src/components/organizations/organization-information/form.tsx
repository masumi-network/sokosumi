"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Organization } from "@sokosumi/database";
import {
  getOrganizationMetadata,
  normalizeOrganizationLogo,
  parseOrganizationMetadata,
} from "@sokosumi/utils";
import { Building2, CloudUpload, Loader2, Trash2 } from "lucide-react";
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

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FileUpload, FileUploadTrigger } from "@/components/ui/file-upload";
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
import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";
import {
  ORGANIZATION_LOGO_ACCEPT,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
} from "@/lib/constants/organization-logo";
import {
  type OrganizationInformationFormSchemaType,
  organizationInformationFormSchema,
} from "@/lib/schemas";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

import { organizationInformationFormData } from "./data";
import { FormFields } from "./form-fields";

class LogoUploadClientTimeoutError extends Error {
  constructor() {
    super("Logo upload timed out");
    this.name = "LogoUploadClientTimeoutError";
  }
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new LogoUploadClientTimeoutError());
    }, ms);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

function buildOrganizationMetadataWithUrl(
  metadata: Record<string, unknown> | null | undefined,
  rawUrl: string,
): Record<string, unknown> | null {
  const normalizedUrl = rawUrl.trim();
  const metadataRecord = metadata ?? {};

  if (normalizedUrl.length === 0) {
    const { url: _url, ...metadataWithoutUrl } = metadataRecord;
    return Object.keys(metadataWithoutUrl).length > 0
      ? metadataWithoutUrl
      : null;
  }

  return {
    ...metadataRecord,
    url: normalizedUrl,
  };
}

interface OrganizationInformationFormProps {
  organization: Organization | null;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onLogoUploadBusyChange?: (busy: boolean) => void;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export default function OrganizationInformationForm({
  organization,
  setIsLoading,
  onLogoUploadBusyChange,
  onOpenChange,
}: OrganizationInformationFormProps) {
  const t = useTranslations("Components.Organizations.InformationModal.Form");
  const router = useRouter();
  const submitInFlightRef = useRef(false);
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

  const handleLogoUpload = useCallback(
    async (files: File[]) => {
      const logoFile = files[0];
      if (!logoFile) return;

      setIsUploadingLogo(true);
      onLogoUploadBusyChange?.(true);
      try {
        const uploadedFile = await raceWithTimeout(
          uploadUserFileDirect(logoFile),
          ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
        );
        form.setValue("logo", uploadedFile.publicUrl, { shouldDirty: true });
      } catch (error) {
        toast.error(
          error instanceof LogoUploadClientTimeoutError
            ? t("Fields.Logo.uploadError")
            : getUserFileUploadErrorMessage(
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
    [form, onLogoUploadBusyChange, t],
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
      let result;
      const isCreating = !organization;
      const logoForApi = normalizeOrganizationLogo(values.logo);
      const metadataForApi = buildOrganizationMetadataWithUrl(
        values.metadata,
        values.url ?? "",
      );

      if (isCreating) {
        const slugResult = await generateOrganizationSlug({
          name: values.name,
          metadata: values.metadata ?? {
            url: values.url ?? null,
            invoiceEmail: null,
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
            logo: logoForApi ?? "",
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
        toast.success(isCreating ? t("Success.create") : t("Success.edit"));

        if (isCreating) {
          try {
            const persistenceResult = await updatePreferredOrganization({
              organizationId: result.data.id,
            });

            if (!persistenceResult.ok) {
              console.error(
                "Failed to persist preferred organization:",
                persistenceResult.error,
              );
            }
          } catch (error) {
            console.error("Failed to persist preferred organization:", error);
          }
        }

        router.refresh();
        onOpenChange(false);
      }
    } finally {
      submitInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const isCreating = !organization;
  const isLoading = form.formState.isSubmitting || isUploadingLogo;

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
                  <div className="max-w-24 space-y-3">
                    <FileUpload
                      value={pendingLogoFiles}
                      onValueChange={setPendingLogoFiles}
                      accept={ORGANIZATION_LOGO_ACCEPT}
                      maxFiles={1}
                      maxSize={ORGANIZATION_LOGO_MAX_SIZE_BYTES}
                      multiple={false}
                      disabled={isLoading}
                      onAccept={handleLogoUpload}
                      onFileReject={(_file, message) => {
                        const translatedMessage =
                          message === "File too large"
                            ? t("Fields.Logo.fileTooLarge")
                            : message === "File type not accepted"
                              ? t("Fields.Logo.fileTypeNotAccepted")
                              : message?.startsWith("Maximum")
                                ? t("Fields.Logo.maxFilesExceeded")
                                : (message ?? t("Fields.Logo.uploadError"));
                        toast.error(translatedMessage);
                      }}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <FileUploadTrigger asChild>
                          <button
                            type="button"
                            disabled={isLoading}
                            aria-label={
                              logoValue
                                ? t("Fields.Logo.replace")
                                : t("Fields.Logo.upload")
                            }
                            className="group bg-muted focus-visible:ring-ring/60 relative size-24 cursor-pointer overflow-hidden rounded-lg border transition-opacity outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Avatar className="size-full rounded-none">
                              <AvatarImage
                                src={logoValue || undefined}
                                alt={t("Fields.Logo.previewAlt")}
                                className="object-cover"
                              />
                              <AvatarFallback className="bg-muted text-muted-foreground rounded-none">
                                <Building2 className="size-8" />
                              </AvatarFallback>
                            </Avatar>
                            <div
                              className={`absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 px-2 text-white transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
                                isUploadingLogo ? "opacity-100" : "opacity-0"
                              }`}
                            >
                              {isUploadingLogo ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <CloudUpload className="size-4" />
                              )}
                              <span className="text-center text-xs leading-tight">
                                {logoValue
                                  ? t("Fields.Logo.replace")
                                  : t("Fields.Logo.upload")}
                              </span>
                            </div>
                          </button>
                        </FileUploadTrigger>
                        {logoValue && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            onClick={handleRemoveLogo}
                            className="size-8"
                            aria-label={t("Fields.Logo.remove")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </FileUpload>
                  </div>
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
