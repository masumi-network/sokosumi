"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  NewsletterConsent,
  NewsletterSubscriberStatus,
} from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { addNewsletterSubscriber } from "@/lib/actions/newsletter/subscribers";
import {
  type NewsletterSubscriberValues,
  newsletterSubscriberSchema,
} from "@/lib/schemas/newsletter-subscribers";
import { NewsletterConsentChoice } from "./newsletter-consent-choice";

interface AddSubscriberDialogProps {
  projectId: string;
  newsletterName: string;
  onClose: () => void;
  onCloseAutoFocus: () => void;
}

export function AddSubscriberDialog({
  projectId,
  newsletterName,
  onClose,
  onCloseAutoFocus,
}: AddSubscriberDialogProps) {
  const t = useTranslations("App.Projects.Newsletter.Subscribers");
  const router = useRouter();
  const form = useForm<NewsletterSubscriberValues>({
    resolver: zodResolver(newsletterSubscriberSchema(t)),
    defaultValues: { email: "", name: "", consentConfirmed: false },
  });
  const { isSubmitting } = form.formState;
  const consent = form.watch("consent");
  const consentConfirmed = form.watch("consentConfirmed") ?? false;

  async function handleSubmit(values: NewsletterSubscriberValues) {
    form.clearErrors();
    try {
      const result = await addNewsletterSubscriber({ projectId, values });
      if (!result.ok) {
        const fields = result.error.fieldErrors;
        if (fields?.email)
          form.setError(
            "email",
            { message: fields.email[0] },
            { shouldFocus: true },
          );
        if (fields?.name)
          form.setError(
            "name",
            { message: fields.name[0] },
            { shouldFocus: !fields.email },
          );
        if (fields?.consent)
          form.setError(
            "consent",
            { message: fields.consent[0] },
            { shouldFocus: !fields.email && !fields.name },
          );
        if (!fields?.email && !fields?.name && !fields?.consent)
          form.setError("root", { message: result.error.message });
        return;
      }
      toast.success(
        t(
          result.value.status === NewsletterSubscriberStatus.PENDING
            ? "Add.pendingConfirmation"
            : "Add.success",
        ),
      );
      router.refresh();
      onClose();
    } catch {
      form.setError("root", { message: t("Add.error") });
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
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus();
        }}
        className="max-h-[90dvh] overflow-y-auto overscroll-contain"
      >
        <DialogHeader>
          <DialogTitle>{t("add")}</DialogTitle>
          <DialogDescription>{t("Add.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-5"
          >
            <fieldset disabled={isSubmitting} className="min-w-0 space-y-4">
              {(["email", "name"] as const).map((name) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t(`Add.${name}`)}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={name === "email" ? "email" : "text"}
                          required={name === "email"}
                          autoComplete={name}
                          maxLength={name === "email" ? 254 : 200}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              <FormField
                control={form.control}
                name="consent"
                render={({ field, fieldState }) => (
                  <NewsletterConsentChoice
                    newsletterName={newsletterName}
                    value={field.value}
                    confirmed={consentConfirmed}
                    onValueChange={field.onChange}
                    onConfirmedChange={(confirmed) =>
                      form.setValue("consentConfirmed", confirmed, {
                        shouldValidate: true,
                      })
                    }
                    error={
                      fieldState.error?.message ??
                      form.formState.errors.consentConfirmed?.message
                    }
                    disabled={isSubmitting}
                  />
                )}
              />
            </fieldset>
            {form.formState.errors.root?.message ? (
              <p
                role="alert"
                className="text-semantic-destructive-label text-sm"
              >
                {form.formState.errors.root.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={onClose}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={isSubmitting}
                disabled={
                  !consent ||
                  (consent === NewsletterConsent.CONFIRMED && !consentConfirmed)
                }
              >
                {t("add")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
