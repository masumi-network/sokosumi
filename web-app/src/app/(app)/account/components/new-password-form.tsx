"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
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
import { createCredentialAccount } from "@/lib/actions";
import { newPasswordFormSchema, NewPasswordFormType } from "@/lib/schemas";

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
      form.reset();
      router.refresh();
    } else {
      const errorMessage = result.error.message ?? t("error");
      toast.error(errorMessage);
    }
  };

  return (
    <Card className="flex h-full flex-col">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <fieldset
            className="space-y-6"
            disabled={form.formState.isSubmitting}
          >
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
            <CardFooter>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="w-full"
              >
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("submit")}
              </Button>
            </CardFooter>
          </fieldset>
        </form>
      </Form>
    </Card>
  );
}
