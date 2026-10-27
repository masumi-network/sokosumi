"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  NewsletterTemplate,
  type ProjectImageAsset,
} from "@sokosumi/core-client";
import { newsletterDraftInputSchema } from "@sokosumi/utils";
import { WandSparkles } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  draftNewsletterIssue,
  getNewsletterDraftImages,
} from "@/lib/actions/newsletter/draft";
import { newsletterHref } from "../newsletter-tabs";

export function DraftIssueButton({
  projectId,
  template = NewsletterTemplate.TEXT,
}: {
  projectId: string;
  template?: NewsletterTemplate;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Ai");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <WandSparkles aria-hidden />
        {t("action")}
      </Button>
      {open ? (
        <DraftIssueDialog
          projectId={projectId}
          template={template}
          onClose={() => setOpen(false)}
          onCloseAutoFocus={() => trigger.current?.focus()}
        />
      ) : null}
    </>
  );
}

function DraftIssueDialog({
  projectId,
  template,
  onClose,
  onCloseAutoFocus,
}: {
  projectId: string;
  template: NewsletterTemplate;
  onClose: () => void;
  onCloseAutoFocus: () => void;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const router = useRouter();
  const [images, setImages] = useState<ProjectImageAsset[] | null>(null);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imagesError, setImagesError] = useState("");
  const form = useForm<
    z.input<typeof newsletterDraftInputSchema>,
    unknown,
    z.output<typeof newsletterDraftInputSchema>
  >({
    resolver: zodResolver(newsletterDraftInputSchema, {
      error: () => t("Ai.invalid"),
    }),
    defaultValues: {
      brief: "",
      useProjectMemory: true,
      useRecentSocialPosts: true,
      template,
      imageIds: [],
    },
  });
  const { isSubmitting, errors } = form.formState;

  async function handlePickImages() {
    setLoadingImages(true);
    setImagesError("");
    try {
      const result = await getNewsletterDraftImages({ projectId });
      if (result.ok) setImages(result.value);
      else setImagesError(result.error.message);
    } catch {
      setImagesError(t("Ai.imagesError"));
    } finally {
      setLoadingImages(false);
    }
  }

  async function handleGenerate(
    values: z.output<typeof newsletterDraftInputSchema>,
  ) {
    if (isSubmitting) return;
    form.clearErrors("root");
    try {
      const result = await draftNewsletterIssue({ projectId, values });
      if (!result.ok) {
        form.setError("root", { message: result.error.message });
        if (result.error.fieldErrors?.brief?.[0])
          form.setError(
            "brief",
            { message: result.error.fieldErrors.brief[0] },
            { shouldFocus: true },
          );
        return;
      }
      router.push(
        `${newsletterHref(`/newsletter/issues/${result.value.id}`, projectId)}&draftedBySokoBot=true`,
      );
      onClose();
    } catch {
      form.setError("root", { message: t("Ai.error") });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("Ai.action")}</DialogTitle>
          <DialogDescription>{t("Ai.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(handleGenerate)}
            className="space-y-6"
          >
            <fieldset disabled={isSubmitting} className="min-w-0 space-y-5">
              <FormField
                control={form.control}
                name="brief"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Ai.brief")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={4}
                        maxLength={10_000}
                        placeholder={t("Ai.placeholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-3">
                {(["useProjectMemory", "useRecentSocialPosts"] as const).map(
                  (name) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name}
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-3">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) =>
                                field.onChange(checked === true)
                              }
                            />
                          </FormControl>
                          <FormLabel className="font-normal">
                            {t(`Ai.${name}`)}
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  ),
                )}
              </div>
              <FormField
                control={form.control}
                name="template"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Ai.template")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.values(NewsletterTemplate).map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`Templates.${value}.title`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  loading={loadingImages}
                  onClick={() => void handlePickImages()}
                >
                  {t("Ai.pickImages")}
                </Button>
                <p className="text-muted-foreground text-sm">
                  {t("Ai.imagesHint")}
                </p>
                {imagesError ? (
                  <p
                    role="alert"
                    className="text-semantic-destructive-label text-sm"
                  >
                    {imagesError}
                  </p>
                ) : null}
                {images?.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("Ai.noImages")}
                  </p>
                ) : null}
                {images?.length ? (
                  <FormField
                    control={form.control}
                    name="imageIds"
                    render={({ field }) => (
                      <FormItem>
                        <fieldset className="space-y-3">
                          <legend className="text-sm font-medium">
                            {t("Ai.images")}
                          </legend>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {images.map((image) => {
                              const selected =
                                field.value?.includes(image.id) ?? false;
                              return (
                                <label
                                  key={image.id}
                                  className="flex min-w-0 cursor-pointer flex-col gap-2 rounded-md border p-2"
                                >
                                  <Image
                                    src={assetContentUrl(image)}
                                    alt=""
                                    width={image.width || 240}
                                    height={image.height || 240}
                                    unoptimized
                                    className="aspect-square w-full rounded-sm object-cover"
                                  />
                                  <span className="flex items-start gap-2 text-sm break-words">
                                    <Checkbox
                                      checked={selected}
                                      disabled={
                                        !selected &&
                                        (field.value?.length ?? 0) >= 10
                                      }
                                      onCheckedChange={(checked) =>
                                        field.onChange(
                                          checked === true
                                            ? [...(field.value ?? []), image.id]
                                            : field.value?.filter(
                                                (id) => id !== image.id,
                                              ),
                                        )
                                      }
                                    />
                                    {image.prompt}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </div>
            </fieldset>
            {errors.root?.message ? (
              <p
                role="alert"
                className="text-semantic-destructive-label text-sm"
              >
                {errors.root.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={onClose}
              >
                {t("Ai.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={isSubmitting}
                disabled={loadingImages}
              >
                {t("Ai.generate")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
