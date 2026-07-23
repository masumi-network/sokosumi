"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import {
  createAdminVendorAction,
  patchAdminVendorAction,
} from "@/lib/actions/admin-vendors/action";
import { CommonErrorCode } from "@/lib/actions/errors";
import type { Vendor } from "@/lib/clients/generated/core";
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

const createVendorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  logos: z.object({
    light: z.string().nullable(),
    dark: z.string().nullable(),
  }),
});

const editVendorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string(),
  logos: z.object({
    light: z.string().nullable(),
    dark: z.string().nullable(),
  }),
});

type VendorFormValues = z.infer<typeof createVendorSchema>;

interface VendorFormCreateProps {
  mode: "create";
}

interface VendorFormEditProps {
  mode: "edit";
  vendor: Vendor;
}

type VendorFormProps = VendorFormCreateProps | VendorFormEditProps;

function emptyLogos(): VendorFormValues["logos"] {
  return { light: null, dark: null };
}

export function VendorForm(props: VendorFormProps) {
  const t = useTranslations("App.Admin.Vendors.Form");
  const tLogo = useTranslations("App.Admin.Vendors.Form.logos");
  const router = useRouter();
  const submitInFlightRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [baseline, setBaseline] = useState<Vendor | null>(
    props.mode === "edit" ? props.vendor : null,
  );
  const [pendingLightLogoFiles, setPendingLightLogoFiles] = useState<File[]>(
    [],
  );
  const [pendingDarkLogoFiles, setPendingDarkLogoFiles] = useState<File[]>([]);
  const [isUploadingLightLogo, setIsUploadingLightLogo] = useState(false);
  const [isUploadingDarkLogo, setIsUploadingDarkLogo] = useState(false);

  const form = useForm<VendorFormValues>({
    resolver: zodResolver(
      props.mode === "create" ? createVendorSchema : editVendorSchema,
    ),
    defaultValues:
      props.mode === "edit"
        ? {
            name: props.vendor.name,
            slug: props.vendor.slug,
            logos: {
              light: props.vendor.logos.light,
              dark: props.vendor.logos.dark,
            },
          }
        : {
            name: "",
            slug: "",
            logos: emptyLogos(),
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

  const handleSubmit = form.handleSubmit(async (values) => {
    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setIsSaving(true);
    try {
      if (props.mode === "create") {
        const result = await createAdminVendorAction({
          input: {
            name: values.name,
            slug: values.slug,
            logos: values.logos,
          },
        });

        if (!result.ok) {
          toast.error(
            result.error.code === CommonErrorCode.BAD_INPUT
              ? t("invalidInput")
              : t("saveFailed"),
          );
          return;
        }

        toast.success(t("createSuccess"));
        router.push(`/admin/vendors/${result.data.id}`);
        router.refresh();
        return;
      }

      if (!baseline) {
        toast.error(t("saveFailed"));
        return;
      }

      const result = await patchAdminVendorAction({
        input: {
          vendorId: baseline.id,
          name: values.name,
          logos: values.logos,
          current: {
            name: baseline.name,
            logos: baseline.logos,
          },
        },
      });

      if (!result.ok) {
        toast.error(
          result.error.code === CommonErrorCode.NOT_FOUND
            ? t("notFound")
            : result.error.code === CommonErrorCode.BAD_INPUT
              ? t("invalidInput")
              : t("saveFailed"),
        );
        return;
      }

      setBaseline(result.data);
      form.reset({
        name: result.data.name,
        slug: result.data.slug,
        logos: {
          light: result.data.logos.light,
          dark: result.data.logos.dark,
        },
      });
      toast.success(t("saveSuccess"));
      router.refresh();
    } finally {
      setIsSaving(false);
      submitInFlightRef.current = false;
    }
  });

  const isDisabled =
    isSaving ||
    isUploadingLightLogo ||
    isUploadingDarkLogo ||
    (props.mode === "edit" && !form.formState.isDirty);

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
                <Input
                  {...field}
                  autoComplete="off"
                  readOnly={props.mode === "edit"}
                  disabled={props.mode === "edit"}
                  className={props.mode === "edit" ? "bg-muted" : undefined}
                />
              </FormControl>
              <p className="text-muted-foreground text-sm">
                {props.mode === "edit"
                  ? t("slugHintEdit")
                  : t("slugHintCreate")}
              </p>
              <FormMessage />
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
          {props.mode === "create" ? t("create") : t("save")}
        </Button>
      </form>
    </Form>
  );
}
