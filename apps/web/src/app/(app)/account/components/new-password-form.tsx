"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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
import { createCredentialAccount } from "@/lib/actions/auth/action";
import {
  type NewPasswordFormType,
  newPasswordFormSchema,
} from "@/lib/schemas/account";

export function NewPasswordForm() {
  const t = useTranslations("App.Account.NewPassword");
  const router = useRouter();

  const form = useForm<NewPasswordFormType>({
    resolver: zodResolver(
      newPasswordFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  const handleSubmit = async (values: NewPasswordFormType) => {
    const result = await createCredentialAccount(values);

    if (result.ok) {
      toast.success(t("success"));
    } else {
      toast.error(result.error.message ?? t("error"));
      return;
    }
    form.reset();
    router.refresh();
  };

  const { isSubmitting } = form.formState;

  return (
    <Card className="flex h-full flex-col">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <fieldset className="space-y-6" disabled={isSubmitting}>
            <CardHeader>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("newPassword")}</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmNewPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("confirmPassword")}</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </fieldset>
          {/* Outside the fieldset: its `disabled` would also disable the
              loading submit button, fading it and dropping focus. */}
          <CardFooter>
            <Button type="submit" loading={isSubmitting} className="w-full">
              {t("submit")}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
