"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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

import { signup } from "../actions";
import { signUpFormData } from "./data";

const formSchema = z
  .object({
    email: z.string().email(),
    username: z.string().min(2).max(50),
    password: z
      .string()
      .min(8)
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormData = z.infer<typeof formSchema>;

export default function SignUpForm() {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const router = useRouter();
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: FormData) => {
    const formData = new FormData();
    formData.append("email", values.email);
    formData.append("username", values.username);
    formData.append("password", values.password);

    const result = await signup(formData);

    if (result.success) {
      toast.success(t("success"));
      router.push("/signin");
    } else {
      toast.error(t("error"));
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-6"
      >
        {signUpFormData.map(
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
                      type={type || "text"}
                      placeholder={placeholderKey && t(placeholderKey)}
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
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {t("submit")}
        </Button>
      </form>
    </Form>
  );
}
