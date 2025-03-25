"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
import { createErrorMap } from "@/lib/form";

import { updateName } from "../actions";
import { nameFormSchema, NameFormType } from "../data";

export function NameForm() {
  const t = useTranslations("Account.Name");
  const form = useForm<NameFormType>({
    resolver: zodResolver(nameFormSchema, {
      errorMap: createErrorMap({ t: useTranslations("Auth.Schema") }),
    }),
    defaultValues: {
      name: "",
    },
  });

  const onSubmit = async (values: NameFormType) => {
    const { success } = await updateName(values);
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
