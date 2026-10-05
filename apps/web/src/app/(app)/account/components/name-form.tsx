"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FirstAndLastNameFields } from "@/components/auth/first-and-last-name-fields";
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
import { authClient } from "@/lib/auth/auth.client";
import {
  type AccountNameFormType,
  accountNameFormSchema,
} from "@/lib/schemas/account";

interface NameFormProps {
  /** The display name. Editing the name parts never changes it. */
  name: string;
  firstName: string;
  lastName: string;
}

export function NameForm({ name, firstName, lastName }: NameFormProps) {
  const t = useTranslations("App.Account.Name");
  const router = useRouter();

  const form = useForm<AccountNameFormType>({
    resolver: zodResolver(
      accountNameFormSchema(useTranslations("Library.Auth.Schema"), {
        namePartsRequired: Boolean(firstName || lastName),
      }),
    ),
    defaultValues: { firstName, lastName, name },
  });

  const handleSubmit = async (values: AccountNameFormType) => {
    const updateUserResult = await authClient.updateUser({
      // Both or neither: the schema allows empty parts only for a user who
      // has none, and then the stored parts are left exactly as they are.
      ...(values.firstName && values.lastName
        ? { firstName: values.firstName, lastName: values.lastName }
        : {}),
      name: values.name,
    });

    if (updateUserResult.error) {
      const errorMessage = updateUserResult.error.message ?? t("error");
      toast.error(errorMessage);
    } else {
      toast.success(t("success"));
      form.reset(values);
      router.refresh();
    }
  };

  const { isSubmitting } = form.formState;

  return (
    <Card className="flex h-full flex-col">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <fieldset className="space-y-6" disabled={isSubmitting}>
            <CardHeader>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FirstAndLastNameFields
                control={form.control}
                testIdPrefix="account"
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("displayName")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="nickname"
                        data-testid="account-display-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-pulse" />
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
