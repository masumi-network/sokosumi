"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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

import { updatePassword } from "../actions";
import { passwordFormSchema, PasswordFormType } from "../data";

export function PasswordForm() {
  const t = useTranslations("Account.Password");
  const tSchema = useTranslations("Auth.Schema");

  const form = useForm<PasswordFormType>({
    resolver: zodResolver(passwordFormSchema, {
      errorMap: (error, ctx) => {
        const path = error.path.join(".");
        switch (path) {
          case "newPassword":
            if (error.code === z.ZodIssueCode.invalid_string) {
              return { message: tSchema("Password.invalid") };
            }
            if (error.code === z.ZodIssueCode.too_small) {
              return { message: tSchema("Password.min") };
            }
            if (error.code === z.ZodIssueCode.too_big) {
              return { message: tSchema("Password.max") };
            }
            if (error.code === z.ZodIssueCode.custom) {
              const { lowercase, uppercase, number } = error.params ?? {};
              if (lowercase) return { message: tSchema("Password.lowercase") };
              if (uppercase) return { message: tSchema("Password.uppercase") };
              if (number) return { message: tSchema("Password.number") };
            }
          case "currentPassword":
            if (error.code === z.ZodIssueCode.too_small) {
              return { message: tSchema("Password.required") };
            }
          case "confirmNewPassword":
            if (error.code === z.ZodIssueCode.custom) {
              return { message: tSchema("ConfirmPassword.match") };
            }
        }
        return { message: ctx.defaultError };
      },
    }),
  });

  const onSubmit = async (values: PasswordFormType) => {
    try {
      await updatePassword(values);
      toast.success(t("success"));
      form.reset();
    } catch {
      toast.error(t("error"));
    }
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("currentPassword")}</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
          </form>
        </Form>
      </CardContent>
      <CardFooter>
        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          onClick={form.handleSubmit(onSubmit)}
          className="w-full"
        >
          {t("submit")}
        </Button>
      </CardFooter>
    </Card>
  );
}
