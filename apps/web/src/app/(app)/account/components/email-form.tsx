"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useAuthCaptcha } from "@/components/auth-captcha";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { changeEmail } from "@/lib/auth/auth.client";
import { getAbsoluteAuthRedirectUrl } from "@/lib/auth/auth.utils";
import { type EmailFormSchemaType, emailFormSchema } from "@/lib/schemas/auth";

interface EmailFormProps {
  /** The address the account signs in with today. */
  currentEmail?: string;
}

export function EmailForm({ currentEmail }: EmailFormProps) {
  const t = useTranslations("App.Account.Email");
  const router = useRouter();
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("change-email");

  const form = useForm<EmailFormSchemaType>({
    resolver: zodResolver(
      emailFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: "",
    },
  });

  const handleSubmit = async (values: EmailFormSchemaType) => {
    await runWithCaptcha(async (fetchOptions) => {
      const changeEmailResult = await changeEmail({
        fetchOptions,
        newEmail: values.email,
        callbackURL: getAbsoluteAuthRedirectUrl("/"),
      });

      if (changeEmailResult.error) {
        const errorMessage = getErrorMessage(
          changeEmailResult.error,
          changeEmailResult.error.message ?? t("error"),
        );
        toast.error(errorMessage);
      } else {
        // Better Auth only sends a link to the new address; the email changes
        // when that link is opened, so this is not a success yet.
        toast.success(t("success", { email: values.email }));
        form.reset();
        router.refresh();
      }
    });
  };

  const { isSubmitting } = form.formState;

  return (
    <Card className="flex h-full flex-col">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <fieldset className="space-y-6" disabled={isSubmitting}>
            <CardHeader>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>
                {currentEmail
                  ? t("descriptionWithCurrent", { email: currentEmail })
                  : t("description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("newEmail")}</FormLabel>
                    <FormControl>
                      <Input placeholder="mail@sokosumi.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </fieldset>
          {/* Outside the fieldset: its `disabled` would also disable the
              loading submit button, fading it and dropping focus. */}
          <CardFooter className="flex-col gap-4">
            {captcha}
            <Button type="submit" loading={isSubmitting} className="w-full">
              {t("submit")}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
