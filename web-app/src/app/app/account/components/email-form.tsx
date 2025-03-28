"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { updateEmail } from "@/app/account/actions";
import { emailFormSchema, EmailFormType } from "@/app/account/data";
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

export function EmailForm() {
  const t = useTranslations("App.Account.Email");
  const form = useForm<EmailFormType>({
    resolver: zodResolver(
      emailFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (values: EmailFormType) => {
    const { success } = await updateEmail(values);
    if (success) {
      toast.success(t("success"));
      form.reset();
    } else {
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
