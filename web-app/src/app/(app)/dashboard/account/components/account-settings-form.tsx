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

import { deleteAccount, updateEmail, updatePassword } from "../actions";
import {
  DeleteAccountFormType,
  deleteAccountSchema,
  emailFormSchema,
  EmailFormType,
  passwordFormSchema,
  PasswordFormType,
} from "../data";

export function AccountSettingsForm() {
  const t = useTranslations("Account");
  const router = useRouter();

  const emailForm = useForm<EmailFormType>({
    resolver: zodResolver(emailFormSchema()),
    defaultValues: {
      email: "",
      currentPassword: "",
    },
  });

  const passwordForm = useForm<PasswordFormType>({
    resolver: zodResolver(passwordFormSchema()),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  const deleteAccountForm = useForm<DeleteAccountFormType>({
    resolver: zodResolver(deleteAccountSchema()),
    defaultValues: {
      currentPassword: "",
    },
  });

  const onEmailSubmit = async (values: EmailFormType) => {
    const result = await updateEmail(values);

    if (result.success) {
      toast.success(t("Email.success"));
      emailForm.reset();
    } else {
      toast.error(result.error || t("Email.error"));
    }
  };

  const onPasswordSubmit = async (values: PasswordFormType) => {
    const result = await updatePassword(values);

    if (result.success) {
      toast.success(t("Password.success"));
      passwordForm.reset();
    } else {
      toast.error(result.error || t("Password.error"));
    }
  };

  const onDeleteAccountSubmit = async (values: DeleteAccountFormType) => {
    const result = await deleteAccount(values);

    if (result.success) {
      toast.success(t("Delete.success"));
      router.push("/signin");
    } else {
      toast.error(result.error || t("Delete.error"));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("Email.title")}</CardTitle>
          <CardDescription>{t("Email.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...emailForm}>
            <form
              onSubmit={emailForm.handleSubmit(onEmailSubmit)}
              className="space-y-4"
            >
              <FormField
                control={emailForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Email.newEmail")}</FormLabel>
                    <FormControl>
                      <Input placeholder="new@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={emailForm.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Email.currentPassword")}</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={emailForm.formState.isSubmitting}>
                {t("Email.submit")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Password.title")}</CardTitle>
          <CardDescription>{t("Password.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...passwordForm}>
            <form
              onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
              className="space-y-4"
            >
              <FormField
                control={passwordForm.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Password.currentPassword")}</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Password.newPassword")}</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="confirmNewPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Password.confirmPassword")}</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={passwordForm.formState.isSubmitting}
              >
                {t("Password.submit")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">
            {t("Delete.title")}
          </CardTitle>
          <CardDescription>{t("Delete.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive">{t("Delete.button")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("Delete.confirmTitle")}</DialogTitle>
                <DialogDescription>
                  {t("Delete.confirmDescription")}
                </DialogDescription>
              </DialogHeader>
              <Form {...deleteAccountForm}>
                <form
                  onSubmit={deleteAccountForm.handleSubmit(
                    onDeleteAccountSubmit,
                  )}
                  className="space-y-4"
                >
                  <FormField
                    control={deleteAccountForm.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Delete.currentPassword")}</FormLabel>
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
                      disabled={deleteAccountForm.formState.isSubmitting}
                    >
                      {t("Delete.confirm")}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
