"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { signin } from "../actions";
import { signInFormData, signInFormSchema, SignInFormSchemaType } from "./data";

export default function SignInForm() {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(signInFormSchema(t)),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: SignInFormSchemaType) => {
    const formData = new FormData();
    formData.append("email", values.email);
    formData.append("password", values.password);

    const result = await signin(formData);

    if (result.error) {
      toast.error(t("error"));
      return;
    }

    toast.success(t("success"));
    router.push("/dashboard");
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset
          disabled={form.formState.isSubmitting}
          className="flex flex-col gap-6"
        >
          {signInFormData.map(
            ({ name, labelKey, placeholderKey, type, descriptionKey }) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{labelKey && t(labelKey)}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={placeholderKey && t(placeholderKey)}
                        type={type || "text"}
                        {...field}
                      />
                    </FormControl>
                    {descriptionKey && (
                      <FormDescription>{t(descriptionKey)}</FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ),
          )}
          <div className="flex items-center justify-between">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("submit")}
            </Button>
            <div className="text-sm">
              <span className="text-muted-foreground">
                {t("ForgotPassword.text")}{" "}
              </span>
              <Link
                href="/forgot-password"
                className="text-primary font-medium hover:underline"
              >
                {t("ForgotPassword.link")}
              </Link>
            </div>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}
