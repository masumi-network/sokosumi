"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Newsletter } from "@sokosumi/core-client";
import {
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import { ImageIcon, Mail, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveNewsletterSettings } from "@/lib/actions/newsletter/action";
import { ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS } from "@/lib/constants/organization-logo";
import {
  type NewsletterSettingsValues,
  newsletterSettingsSchema,
} from "@/lib/schemas/newsletter";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils/format-bytes";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";
import { NewsletterBrandPreview } from "./newsletter-brand-preview";
import { NewsletterSignupCard } from "./newsletter-signup-card";

const FONTS = [
  { value: "Arial", label: "arial" },
  { value: "Georgia", label: "georgia" },
  { value: "Verdana", label: "verdana" },
  { value: "Times New Roman", label: "timesNewRoman" },
] as const;

interface NewsletterSettingsFormProps {
  projectId: string;
  projectName: string;
  projectLogo: string | null;
  newsletter: Newsletter | null;
}

export function NewsletterSettingsForm({
  projectId,
  projectName,
  projectLogo,
  newsletter,
}: NewsletterSettingsFormProps) {
  const t = useTranslations("App.Projects.Newsletter");
  const validationT = useTranslations("App.Projects.Newsletter.Validation");
  const router = useRouter();
  const [publicSlug, setPublicSlug] = useState(newsletter?.publicSlug);
  const form = useForm<NewsletterSettingsValues>({
    resolver: zodResolver(newsletterSettingsSchema(validationT)),
    defaultValues: {
      name: newsletter?.name ?? projectName,
      senderName: newsletter?.senderName ?? projectName,
      replyTo: newsletter?.replyTo ?? "",
      logoUrl: newsletter
        ? (newsletter.brand.logoUrl ?? "")
        : (projectLogo ?? ""),
      primaryColor: newsletter?.brand.primaryColor ?? "",
      accentColor: newsletter?.brand.accentColor ?? "",
      fontFamily: newsletter?.brand.fontFamily ?? "Arial",
      footerText: newsletter?.brand.footerText ?? "",
      welcomeEmailEnabled: newsletter?.welcomeEmailEnabled ?? false,
      welcomeSubject: newsletter?.welcomeSubject ?? "",
      welcomeBody: newsletter?.welcomeBody ?? "",
    },
  });
  const welcomeEnabled = useWatch({
    control: form.control,
    name: "welcomeEmailEnabled",
  });
  const selectedFont = useWatch({ control: form.control, name: "fontFamily" });
  const logoUrl = useWatch({ control: form.control, name: "logoUrl" });
  const [pendingLogoFiles, setPendingLogoFiles] = useState<File[]>([]);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const { isDirty, isSubmitting } = form.formState;
  const logoT = useTranslations("App.Projects.Newsletter.Logo");
  const logoLabels = {
    fileTooLarge: logoT("fileTooLarge"),
    fileTypeNotAccepted: logoT("fileTypeNotAccepted"),
    maxFilesExceeded: logoT("maxFilesExceeded"),
    previewAlt: logoT("previewAlt"),
    remove: logoT("remove"),
    replace: logoT("replace"),
    upload: logoT("upload"),
    uploadError: logoT("uploadError"),
  };

  // The upload only stores the file; Save still writes `logoUrl`, like every field.
  async function handleLogoUpload(files: File[]) {
    const file = files[0];
    if (!file) return;
    setIsUploadingLogo(true);
    try {
      const uploaded = await raceWithTimeout(
        uploadUserFileDirect(file, {
          allowedContentTypes: [...ORGANIZATION_LOGO_ALLOWED_MIME_TYPES],
          maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
        }),
        ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
      );
      form.setValue("logoUrl", uploaded.publicUrl, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } catch (error) {
      toast.error(
        error instanceof ClientTimeoutError
          ? logoT("uploadError")
          : getUserFileUploadErrorMessage(error, logoT("uploadError")),
      );
    } finally {
      setPendingLogoFiles([]);
      setIsUploadingLogo(false);
    }
  }

  async function handleSubmit(values: NewsletterSettingsValues) {
    form.clearErrors("root");
    try {
      const result = await saveNewsletterSettings({ projectId, values });
      if (!result.ok) {
        form.setError("root", { message: result.error.message });
        Object.entries(result.error.fieldErrors ?? {}).forEach(
          ([name, errors], index) => {
            form.setError(
              name as keyof NewsletterSettingsValues,
              { message: errors?.[0] },
              { shouldFocus: index === 0 },
            );
          },
        );
        return;
      }
      setPublicSlug(result.value.publicSlug);
      form.reset(values);
      toast.success(t("success"));
      router.refresh();
    } catch {
      form.setError("root", { message: t("error") });
    }
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(handleSubmit)}
        className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]"
      >
        <div className={cn(HOLDER_CLASS, "min-w-0 space-y-3 p-3")}>
          {!newsletter && !publicSlug ? (
            <section
              aria-labelledby="newsletter-setup"
              className={cn(HOLDER_ITEM_CLASS, "flex min-w-0 gap-3 p-4")}
            >
              <span
                aria-hidden
                className="bg-quinary text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
              >
                <Mail className="size-5" />
              </span>
              <div className="min-w-0 space-y-1">
                <h3
                  id="newsletter-setup"
                  className="text-base font-semibold text-balance"
                >
                  {t("emptyTitle")}
                </h3>
                <p className="text-muted-foreground text-sm text-pretty">
                  {t("emptyDescription")}
                </p>
              </div>
            </section>
          ) : null}
          {publicSlug ? <NewsletterSignupCard publicSlug={publicSlug} /> : null}
          <fieldset disabled={isSubmitting} className="min-w-0 space-y-3">
            <section aria-labelledby="newsletter-general">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h3 id="newsletter-general">{t("general")}</h3>
                  </CardTitle>
                  <CardDescription>{t("generalDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  {(["name", "senderName", "replyTo"] as const).map((name) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name}
                      render={({ field }) => (
                        <FormItem
                          className={
                            name === "replyTo" ? "md:col-span-2" : undefined
                          }
                        >
                          <FormLabel>{t(`fields.${name}`)}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type={name === "replyTo" ? "email" : "text"}
                              autoComplete={
                                name === "replyTo" ? "email" : "off"
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="newsletter-brand">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h3 id="newsletter-brand">{t("brand")}</h3>
                  </CardTitle>
                  <CardDescription>{t("brandDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="logoUrl"
                    render={() => (
                      <FormItem>
                        <FormLabel>{t("fields.logoUrl")}</FormLabel>
                        <div className="flex min-w-0 flex-wrap items-center gap-4">
                          <FormControl>
                            <OrganizationLogoUploadField
                              disabled={isSubmitting || isUploadingLogo}
                              fallbackIcon={<ImageIcon className="size-8" />}
                              isUploading={isUploadingLogo}
                              labels={logoLabels}
                              logoValue={logoUrl}
                              onPendingLogoFilesChange={setPendingLogoFiles}
                              onRemove={() =>
                                form.setValue("logoUrl", "", {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                              }
                              onUpload={handleLogoUpload}
                              pendingLogoFiles={pendingLogoFiles}
                            />
                          </FormControl>
                          <FormDescription className="min-w-0 flex-1 basis-48">
                            {logoT("description", {
                              maxSize: formatBytes(
                                ORGANIZATION_LOGO_MAX_SIZE_BYTES,
                              ),
                            })}
                          </FormDescription>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    {(["primaryColor", "accentColor"] as const).map((name) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem className="min-w-0">
                            <FormLabel>{t(`fields.${name}`)}</FormLabel>
                            <div className="flex min-w-0 items-center gap-2">
                              <FormControl>
                                <ColorPicker
                                  ref={field.ref}
                                  value={field.value}
                                  onChange={field.onChange}
                                  onBlur={field.onBlur}
                                  disabled={isSubmitting}
                                  placeholder={t("colorPlaceholder")}
                                  presetsLabel={t("presetColors")}
                                  className="min-w-0 flex-1"
                                />
                              </FormControl>
                              {field.value ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t(`clearColor.${name}`)}
                                  onClick={() =>
                                    form.setValue(name, "", {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    })
                                  }
                                >
                                  <X />
                                </Button>
                              ) : null}
                            </div>
                            <FormDescription>{t("colorHint")}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormField
                    control={form.control}
                    name="fontFamily"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("fields.fontFamily")}</FormLabel>
                        <Select
                          name={field.name}
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={isSubmitting}
                        >
                          <FormControl>
                            <SelectTrigger
                              ref={field.ref}
                              onBlur={field.onBlur}
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {FONTS.map((font) => (
                              <SelectItem key={font.value} value={font.value}>
                                {t(`fonts.${font.label}`)}
                              </SelectItem>
                            ))}
                            {!FONTS.some(
                              (font) => font.value === selectedFont,
                            ) ? (
                              <SelectItem value={selectedFont}>
                                {selectedFont}
                              </SelectItem>
                            ) : null}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="footerText"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("fields.footerText")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={3} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="newsletter-welcome">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h3 id="newsletter-welcome">{t("welcome")}</h3>
                  </CardTitle>
                  <CardDescription>
                    {t("welcomeCardDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="welcomeEmailEnabled"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between gap-4">
                        <div className="min-w-0 space-y-1">
                          <FormLabel>
                            {t("fields.welcomeEmailEnabled")}
                          </FormLabel>
                          <FormDescription>
                            {t("welcomeDescription")}
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            name={field.name}
                            ref={field.ref}
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            onBlur={field.onBlur}
                            disabled={isSubmitting}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  {welcomeEnabled ? (
                    <>
                      <FormField
                        control={form.control}
                        name="welcomeSubject"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("fields.welcomeSubject")}</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="welcomeBody"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("fields.welcomeBody")}</FormLabel>
                            <FormControl>
                              <Textarea {...field} rows={6} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </section>
          </fieldset>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-1 pb-1">
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              disabled={isUploadingLogo}
            >
              {t("save")}
            </Button>
            {isDirty && !isSubmitting ? (
              <p className="text-muted-foreground text-sm">
                {t("unsavedChanges")}
              </p>
            ) : null}
            {form.formState.errors.root?.message ? (
              <p role="alert" className="text-destructive basis-full text-sm">
                {form.formState.errors.root.message}
              </p>
            ) : null}
          </div>
        </div>
        <aside className="min-w-0 lg:sticky lg:top-4">
          <NewsletterBrandPreview control={form.control} />
        </aside>
      </form>
    </Form>
  );
}
