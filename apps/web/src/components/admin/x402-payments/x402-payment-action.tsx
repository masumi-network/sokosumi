"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  refundTaskX402PaymentAction,
  resolveTaskX402PaymentAction,
} from "@/lib/actions/admin-task-x402-payments/action";
import type {
  AdminTaskX402RefundReason,
  AdminTaskX402ResolveReason,
} from "@/lib/services/admin-task-x402-payment.service";

const REFUND_REASONS: AdminTaskX402RefundReason[] = [
  "agent_output_quality",
  "duplicate_charge",
  "support_adjustment",
];
const RESOLVE_REASONS: AdminTaskX402ResolveReason[] = [
  "account_deletion_blocked",
  "node_unreachable",
  "sign_attempts_exhausted",
  "unsettleable_authorization",
];

function isRefundReason(value: string): value is AdminTaskX402RefundReason {
  return REFUND_REASONS.some((reason) => reason === value);
}

function isResolveReason(value: string): value is AdminTaskX402ResolveReason {
  return RESOLVE_REASONS.some((reason) => reason === value);
}

interface X402PaymentActionProps {
  paymentId: string;
  asset: string;
  payTo: string;
  action: "refund" | "resolve";
}

export function X402PaymentAction({
  paymentId,
  asset,
  payTo,
  action,
}: X402PaymentActionProps) {
  const t = useTranslations("App.Admin.X402Payments");
  const router = useRouter();
  const reasons = action === "refund" ? REFUND_REASONS : RESOLVE_REASONS;
  const [refundReason, setRefundReason] = useState<AdminTaskX402RefundReason>(
    "agent_output_quality",
  );
  const [resolveReason, setResolveReason] =
    useState<AdminTaskX402ResolveReason>("account_deletion_blocked");
  const reason = action === "refund" ? refundReason : resolveReason;
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      const result =
        action === "refund"
          ? await refundTaskX402PaymentAction({
              paymentId,
              reason: refundReason,
            })
          : await resolveTaskX402PaymentAction({
              paymentId,
              reason: resolveReason,
            });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(t(`Actions.${action}Success`));
      setIsOpen(false);
      router.refresh();
    } catch {
      toast.error(t("Actions.actionFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant={action === "refund" ? "outline" : "destructive"}
        >
          {t(`Actions.${action}`)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`Actions.${action}ConfirmTitle`)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(`Actions.${action}ConfirmDescription`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid gap-2 rounded-md border p-3 text-xs">
          <div>
            <dt className="font-medium">{t("Columns.payment")}</dt>
            <dd className="break-all font-mono">{paymentId}</dd>
          </div>
          <div>
            <dt className="font-medium">{t("Columns.asset")}</dt>
            <dd className="break-all font-mono">{asset}</dd>
          </div>
          <div>
            <dt className="font-medium">{t("Columns.payTo")}</dt>
            <dd className="break-all font-mono">{payTo}</dd>
          </div>
        </dl>
        <div className="space-y-2">
          <Label htmlFor={`${action}-reason-${paymentId}`}>
            {t("Actions.reason")}
          </Label>
          <select
            id={`${action}-reason-${paymentId}`}
            value={reason}
            onChange={(event) => {
              if (action === "refund" && isRefundReason(event.target.value)) {
                setRefundReason(event.target.value);
              } else if (
                action === "resolve" &&
                isResolveReason(event.target.value)
              ) {
                setResolveReason(event.target.value);
              }
            }}
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          >
            {reasons.map((item) => (
              <option key={item} value={item}>
                {t(`Reasons.${item}`)}
              </option>
            ))}
          </select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {t("Actions.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isSubmitting}
            onClick={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className={
              action === "resolve"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {isSubmitting ? t("Actions.submitting") : t(`Actions.${action}`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
