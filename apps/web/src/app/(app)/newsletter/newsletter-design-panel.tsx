"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { NewsletterDesignFields } from "@/app/newsletter/newsletter-design-fields";
import { NewsletterSignupDesignFields } from "@/app/newsletter/newsletter-signup-design-fields";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { saveNewsletterSettings } from "@/lib/actions/newsletter/action";
import type { NewsletterSettingsValues } from "@/lib/schemas/newsletter";
import { cn } from "@/lib/utils";

/**
 * The studio's Design tab: the project's email design, previewed live beside
 * the issue. Save writes the newsletter settings, so it applies to every issue
 * not yet sent.
 * The signup designer reuses the same form and save action.
 */
export function NewsletterDesignPanel({
  form,
  projectId,
  signupForm = false,
}: {
  form: UseFormReturn<NewsletterSettingsValues>;
  projectId: string;
  signupForm?: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter");
  const [isUploading, setIsUploading] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>(() =>
    Object.values(form.getValues("signupForm") ?? {}).some(Boolean)
      ? ["customize"]
      : [],
  );
  const { isDirty, isSubmitting, errors } = form.formState;
  // A closed section unmounts its fields, so an invalid one opens to show why Save failed.
  const invalidSections = Object.keys(errors)
    .filter((name) => name !== "root")
    .map((name) => (name === "signupForm" ? "customize" : "shared"));
  const visibleSections = [...new Set([...openSections, ...invalidSections])];
  const showSave = !signupForm || isDirty || visibleSections.length > 0;

  async function handleSave(values: NewsletterSettingsValues) {
    form.clearErrors("root");
    try {
      const result = await saveNewsletterSettings({ projectId, values });
      if (!result.ok) {
        form.setError("root", { message: result.error.message });
        Object.entries(result.error.fieldErrors ?? {}).forEach(
          ([name, messages], index) => {
            form.setError(
              name as keyof NewsletterSettingsValues,
              { message: messages?.[0] },
              { shouldFocus: index === 0 },
            );
          },
        );
        return;
      }
      form.reset(values);
      toast.success(t("Design.saved"));
    } catch {
      form.setError("root", { message: t("error") });
    }
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(handleSave)}
        aria-label={t(signupForm ? "SignupForm.customize" : "Design.title")}
        className="min-w-0 space-y-4"
      >
        <fieldset disabled={isSubmitting} className="min-w-0 space-y-4">
          {signupForm ? (
            <Accordion
              type="multiple"
              value={visibleSections}
              onValueChange={setOpenSections}
              className={cn(HOLDER_ITEM_CLASS, "min-w-0 px-3")}
            >
              <AccordionItem value="customize">
                <AccordionTrigger className="px-1">
                  {t("SignupForm.customize")}
                </AccordionTrigger>
                <AccordionContent className="px-1">
                  <NewsletterSignupDesignFields disabled={isSubmitting} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="shared">
                <AccordionTrigger className="px-1">
                  {t("SignupForm.sharedDesign")}
                </AccordionTrigger>
                <AccordionContent className="space-y-4 px-1">
                  <p className="text-muted-foreground text-sm">
                    {t("SignupForm.sharedDescription")}
                  </p>
                  <NewsletterDesignFields
                    disabled={isSubmitting}
                    onUploadingChange={setIsUploading}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : (
            <section className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">{t("Design.title")}</h3>
                <p className="text-muted-foreground text-sm">
                  {t("Design.description")}
                </p>
              </div>
              <NewsletterDesignFields
                disabled={isSubmitting}
                onUploadingChange={setIsUploading}
              />
            </section>
          )}
        </fieldset>
        {showSave ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-1">
            <Button
              type="submit"
              variant={isDirty ? "primary" : "outline"}
              loading={isSubmitting}
              disabled={isUploading}
            >
              {t("Design.save")}
            </Button>
            {isDirty && !isSubmitting ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => form.reset()}
              >
                {t("Design.reset")}
              </Button>
            ) : null}
            <p role="status" className="text-muted-foreground text-sm">
              {isDirty && !isSubmitting ? t("unsavedChanges") : null}
            </p>
            {errors.root?.message ? (
              <p role="alert" className="text-foreground basis-full text-sm">
                {errors.root.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </Form>
  );
}
