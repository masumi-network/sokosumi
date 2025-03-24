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

import { updateName } from "../actions";
import { nameFormSchema, NameFormType } from "../data";

export function NameForm() {
  const t = useTranslations("Account.Name");
  const tSchema = useTranslations("Auth.Schema");
  const form = useForm<NameFormType>({
    resolver: zodResolver(nameFormSchema, {
      errorMap: (error, ctx) => {
        const path = error.path.join(".");
        switch (path) {
          case "name":
            if (error.code === z.ZodIssueCode.too_small) {
              return { message: tSchema("Name.min") };
            }
            if (error.code === z.ZodIssueCode.too_big) {
              return { message: tSchema("Name.max") };
            }
            if (error.code === z.ZodIssueCode.invalid_string) {
              return { message: tSchema("Name.invalid") };
            }
          case "currentPassword":
            if (error.code === z.ZodIssueCode.too_small) {
              return { message: tSchema("Password.required") };
            }
        }
        return { message: ctx.defaultError };
      },
    }),
    defaultValues: {
      name: "",
      currentPassword: "",
    },
  });

  const onSubmit = async (values: NameFormType) => {
    try {
      await updateName(values);
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("newName")}</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
