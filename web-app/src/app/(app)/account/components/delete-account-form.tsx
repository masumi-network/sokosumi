"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useAsyncRouter } from "@/hooks/use-async-router";
import { deleteUser } from "@/lib/auth/auth.client";
import { DeleteAccountFormType, deleteAccountSchema } from "@/lib/schemas";

export function DeleteAccountForm() {
  const t = useTranslations("App.Account.Delete");
  const router = useAsyncRouter();

  const form = useForm<DeleteAccountFormType>({
    resolver: zodResolver(
      deleteAccountSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      currentPassword: "",
    },
  });

  const handleSubmit = async (values: DeleteAccountFormType) => {
    const deleteUserResult = await deleteUser({
      password: values.currentPassword,
    });

    if (deleteUserResult.error) {
      toast.error(t("error"));
      return;
    }

    toast.success(t("success"));
    await router.push("/");
  };

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive">{t("button")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("confirmTitle")}</DialogTitle>
              <DialogDescription>{t("confirmDescription")}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)}>
                <fieldset
                  className="space-y-4"
                  disabled={form.formState.isSubmitting}
                >
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
                  <DialogFooter>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={form.formState.isSubmitting}
                    >
                      {form.formState.isSubmitting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {t("confirm")}
                    </Button>
                  </DialogFooter>
                </fieldset>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
