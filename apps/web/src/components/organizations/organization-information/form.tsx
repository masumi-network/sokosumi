"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Organization } from "@sokosumi/database";
import { Building2, CloudUpload, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dispatch, SetStateAction, useCallback, useState } from "react";
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
import {
  updatePreferredOrganization,
  uploadOrganizationLogo,
} from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";
import {
  organizationInformationFormSchema,
  OrganizationInformationFormSchemaType,
} from "@/lib/schemas";

import { organizationInformationFormData } from "./data";
import { FormFields } from "./form-fields";

interface OrganizationInformationFormProps {
  organization: Organization | null;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export default function OrganizationInformationForm({
  organization,
  setIsLoading,
  onOpenChange,
}: OrganizationInformationFormProps) {
  const t = useTranslations("Components.Organizations.InformationModal.Form");
  const router = useRouter();
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
      url: organization?.url ?? "",
      logo: organization?.logo ?? "",
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
      try {
        const uploadResult = await uploadOrganizationLogo(logoFile);
        if (!uploadResult.ok) {
          toast.error(
            uploadResult.error.message ?? t("Fields.Logo.uploadError"),
          );
          return;
        }

        form.setValue("logo", uploadResult.data, { shouldDirty: true });
        toast.success(t("Fields.Logo.uploadSuccess"));
      } catch (_error) {
        toast.error(t("Fields.Logo.uploadError"));
      } finally {
        setPendingLogoFiles([]);
        setIsUploadingLogo(false);
      }
    },
    [form, t],
  );

  const handleRemoveLogo = useCallback(() => {
    form.setValue("logo", "", { shouldDirty: true });
    setPendingLogoFiles([]);
  }, [form]);

  const onSubmit = async (values: OrganizationInformationFormSchemaType) => {
    setIsLoading(true);
    try {
      let result;
      const isCreating = !organization;
      const normalizedUrl = values.url.trim();
      const normalizedLogo = values.logo.trim();
      const createUrlPayload =
        normalizedUrl.length > 0 ? normalizedUrl : undefined;
      const createLogoPayload =
        normalizedLogo.length > 0 ? normalizedLogo : undefined;

      if (isCreating) {
        const slugResult = await generateOrganizationSlug({
          name: values.name,
          url: values.url,
          logo: values.logo,
        });

        if (!slugResult.ok) {
          toast.error(t("Error.create"));
          return;
        }

        const slug = slugResult.data;
        result = await authClient.organization.create({
          slug,
          name: values.name,
          ...(createUrlPayload && { url: createUrlPayload }),
          ...(createLogoPayload && { logo: createLogoPayload }),
        });
      } else {
        result = await authClient.organization.update({
          organizationId: organization.id,
          data: {
            name: values.name,
            url: normalizedUrl,
            logo: normalizedLogo,
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
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      maxFiles={1}
                      maxSize={2 * 1024 * 1024}
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
