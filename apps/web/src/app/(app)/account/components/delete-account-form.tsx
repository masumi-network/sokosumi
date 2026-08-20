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
import {
  IN_FLIGHT_JOB_ERROR_CODE,
  IN_FLIGHT_TASK_ERROR_CODE,
  RUNNING_SUBSCRIPTION_ERROR_CODE,
  TASK_PAYMENT_CLAIM_PENDING_ERROR_CODE,
  TASK_PAYMENT_CLAIM_REVIEW_REQUIRED_ERROR_CODE,
  UNSETTLED_ON_CHAIN_JOB_ERROR_CODE,
  USER_OWNS_ORGANIZATION_ERROR_CODE,
} from "@/lib/actions/errors/better-auth";
import { deleteUser } from "@/lib/auth/auth.client";
import type { UserDeletionEvaluation } from "@/lib/clients/generated/core";
import { type DeleteAccountFormType, deleteAccountSchema } from "@/lib/schemas";

interface DeleteAccountFormProps {
  blockers?: UserDeletionEvaluation["blockers"];
  preflightFailed?: boolean;
  ownedOrganizationSlug?: string | null;
}

interface DeletionBlockerCopy {
  message: string;
  href?: string;
  linkLabel?: string;
}

function userDeletionBlockerCopy(
  code: string,
  t: ReturnType<typeof useTranslations>,
  ownedOrganizationSlug?: string | null,
): DeletionBlockerCopy {
  if (code === USER_OWNS_ORGANIZATION_ERROR_CODE) {
    return {
      message: t("Errors.userOwnsOrganization"),
      href: ownedOrganizationSlug
        ? `/organizations/${encodeURIComponent(ownedOrganizationSlug)}`
        : undefined,
      linkLabel: t("Links.organizationMembers"),
    };
  }
  if (code === IN_FLIGHT_JOB_ERROR_CODE) {
    return {
      message: t("Errors.inFlightJob"),
      href: "/history",
      linkLabel: t("Links.jobs"),
    };
  }
  if (code === UNSETTLED_ON_CHAIN_JOB_ERROR_CODE) {
    return {
      message: t("Errors.unsettledOnChainJob"),
      href: "/history",
      linkLabel: t("Links.jobs"),
    };
  }
  if (code === IN_FLIGHT_TASK_ERROR_CODE) {
    return {
      message: t("Errors.inFlightTask"),
      href: "/tasks",
      linkLabel: t("Links.tasks"),
    };
  }
  if (code === RUNNING_SUBSCRIPTION_ERROR_CODE) {
    return {
      message: t("Errors.runningSubscription"),
      href: "/billing",
      linkLabel: t("Errors.billingLink"),
    };
  }
  if (code === TASK_PAYMENT_CLAIM_REVIEW_REQUIRED_ERROR_CODE) {
    return { message: t("Errors.taskPaymentClaimReviewRequired") };
  }
  if (code === TASK_PAYMENT_CLAIM_PENDING_ERROR_CODE) {
    return { message: t("Errors.taskPaymentClaimPending") };
  }
  return { message: t("error") };
}

function userDeletionBlockerMessage(
  code: string,
  t: ReturnType<typeof useTranslations>,
  ownedOrganizationSlug?: string | null,
): string {
  return userDeletionBlockerCopy(code, t, ownedOrganizationSlug).message;
}

export function DeleteAccountForm({
  blockers = [],
  preflightFailed = false,
  ownedOrganizationSlug = null,
}: DeleteAccountFormProps) {
  const t = useTranslations("App.Account.Delete");
  const router = useRouter();
  const confirmDisabled = blockers.length > 0 || preflightFailed;

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
      toast.error(
        userDeletionBlockerMessage(deleteUserResult.error.code ?? "", t),
      );
    } else {
      toast.success(t("success"));
      router.push("/");
    }
  };

  const { isSubmitting } = form.formState;

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
            {preflightFailed ? (
              <div className="space-y-2">
                <p className="text-destructive text-sm">
                  {t("preflightError")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.refresh()}
                >
                  {t("retry")}
                </Button>
              </div>
            ) : null}
            {blockers.length > 0 ? (
              <div className="space-y-2">
                <p className="text-destructive text-sm">{t("blockersTitle")}</p>
                <ul className="text-destructive list-disc space-y-1 pl-5 text-sm">
                  {blockers.map((code) => {
                    const copy = userDeletionBlockerCopy(
                      code,
                      t,
                      ownedOrganizationSlug,
                    );
                    return (
                      <li key={code}>
                        {copy.message}
                        {copy.href && copy.linkLabel ? (
                          <>
                            {" "}
                            <Link href={copy.href} className="underline">
                              {copy.linkLabel}
                            </Link>
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)}>
                <fieldset className="space-y-4" disabled={isSubmitting}>
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
                      disabled={isSubmitting || confirmDisabled}
                    >
                      {isSubmitting && (
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
