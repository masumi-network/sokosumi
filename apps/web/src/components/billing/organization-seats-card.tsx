"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
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
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  type ActionError,
  toActionRejectionError,
} from "@/lib/actions/errors/action-error";
import {
  previewOrganizationSubscriptionSeats,
  updateOrganizationSubscriptionSeats,
} from "@/lib/actions/subscription/action";
import {
  resolveMinimumOrganizationSeats,
  SeatCountInput,
} from "./organization-seat-settings-fields";

const INPUT_ID = "organization-seats-change";

interface OrganizationSeatsCardProps {
  assignedCount: number;
  currentSeats: number;
  onError: (error: ActionError) => void;
  organizationId: string;
  scheduledCancelDate: Date | null;
  scheduledSeats: number | null;
  scheduledSeatsAt: Date | null;
}

interface SeatChangeDialogProps {
  actionLabel: string;
  assignedCount: number;
  currentSeats: number;
  onClose: () => void;
  onError: (error: ActionError) => void;
  organizationId: string;
  scheduledCancelDate: Date | null;
  seats: number;
}

export function OrganizationSeatsCard({
  assignedCount,
  currentSeats,
  onError,
  organizationId,
  scheduledCancelDate,
  scheduledSeats,
  scheduledSeatsAt,
}: OrganizationSeatsCardProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const formatter = useFormatter();
  const committedSeats = scheduledSeats ?? currentSeats;
  const [targetSeats, setTargetSeats] = useState<number | null>(committedSeats);
  const [dialogSeats, setDialogSeats] = useState<number | null>(null);

  const validTargetSeats =
    targetSeats !== null && targetSeats >= resolveMinimumOrganizationSeats()
      ? targetSeats
      : null;
  const seatChange =
    validTargetSeats === null ? 0 : validTargetSeats - currentSeats;

  const isRemovalBlocked = seatChange < 0 && scheduledCancelDate !== null;
  const keepLabel = t("seatsCard.keepCta", { count: currentSeats });

  let actionLabel = t("seatsCard.addIdleCta");
  if (seatChange > 0) {
    actionLabel = t("seatsCard.addCta", { count: seatChange });
  } else if (seatChange < 0) {
    actionLabel = t("seatsCard.removeCta", { count: -seatChange });
  } else if (scheduledSeats !== null) {
    actionLabel = keepLabel;
  }

  function formatDate(date: Date) {
    return formatter.dateTime(date, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6 md:space-y-0">
        <div className="space-y-1">
          <label htmlFor={INPUT_ID} className="text-sm font-medium">
            {t("seatsInputLabel")}
          </label>
          <p className="text-muted-foreground text-xs">
            {t("seatsCard.summary", {
              assigned: assignedCount,
              purchased: currentSeats,
            })}
          </p>
          {scheduledSeats !== null && scheduledSeatsAt ? (
            <p className="text-xs font-medium">
              {t("seatsCard.scheduledNote", {
                date: formatDate(scheduledSeatsAt),
                seats: scheduledSeats,
              })}{" "}
              <Button
                className="h-auto p-0 text-xs"
                onClick={() => setDialogSeats(currentSeats)}
                variant="link"
              >
                {keepLabel}
              </Button>
            </p>
          ) : null}
          {isRemovalBlocked && scheduledCancelDate ? (
            <p className="text-muted-foreground text-xs">
              {t("seatsCard.removeBlocked", {
                date: formatDate(scheduledCancelDate),
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="sm:w-44">
            <SeatCountInput
              id={INPUT_ID}
              onChange={setTargetSeats}
              value={targetSeats}
            />
          </div>
          <Button
            className="sm:min-w-44"
            disabled={
              validTargetSeats === null ||
              validTargetSeats === committedSeats ||
              isRemovalBlocked
            }
            onClick={() => setDialogSeats(validTargetSeats)}
            variant="primary"
          >
            {actionLabel}
          </Button>
        </div>
      </CardContent>
      {dialogSeats !== null ? (
        <SeatChangeDialog
          actionLabel={dialogSeats === currentSeats ? keepLabel : actionLabel}
          assignedCount={assignedCount}
          currentSeats={currentSeats}
          onClose={() => setDialogSeats(null)}
          onError={onError}
          organizationId={organizationId}
          scheduledCancelDate={scheduledCancelDate}
          seats={dialogSeats}
        />
      ) : null}
    </Card>
  );
}

/** Mounted only while open, so every opening asks Stripe for a fresh price. */
function SeatChangeDialog({
  actionLabel,
  assignedCount,
  currentSeats,
  onClose,
  onError,
  organizationId,
  scheduledCancelDate,
  seats,
}: SeatChangeDialogProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const formatter = useFormatter();
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);

  const preview = useQuery({
    gcTime: 0,
    queryFn: async () => {
      const result = await previewOrganizationSubscriptionSeats({
        organizationId,
        seats,
      });
      if (!result.ok) {
        throw new Error(result.error.message ?? "Failed to preview seats");
      }
      return result.value;
    },
    queryKey: [
      "organization-subscription-seats-preview",
      organizationId,
      seats,
    ],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const isAdding = seats > currentSeats;
  const isRemoving = seats < currentSeats;
  const seatChangeCount = Math.abs(seats - currentSeats);
  const seatsLost = Math.max(assignedCount - seats, 0);

  let title = t("seatsCard.dialog.keepTitle", { count: seats });
  let description = t("seatsCard.dialog.keepDescription");
  if (isAdding) {
    title = t("seatsCard.dialog.addTitle", { count: seatChangeCount });
    description = t("seatsCard.dialog.addDescription");
  } else if (isRemoving) {
    title = t("seatsCard.dialog.removeTitle", { count: seatChangeCount });
    description = t("seatsCard.dialog.removeDescription");
  }

  function formatAmount(amount: number, currency: string) {
    return formatter.number(amount / 100, {
      style: "currency",
      currency: currency.toUpperCase(),
    });
  }

  async function handleConfirm() {
    setIsUpdating(true);
    try {
      const result = await updateOrganizationSubscriptionSeats({
        organizationId,
        seats,
      });
      if (!result.ok) {
        onError(result.error);
        return;
      }

      toast.success(
        result.value.scheduledSeats === null
          ? t("seatsUpdatedSuccess")
          : t("seatsScheduledSuccess"),
      );
      router.refresh();
    } catch (error) {
      onError(toActionRejectionError(error));
    } finally {
      setIsUpdating(false);
      onClose();
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !isUpdating) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          {preview.isPending ? (
            <p className="text-muted-foreground" role="status">
              {t("seatsCard.dialog.loading")}
            </p>
          ) : null}
          {preview.isError ? (
            <div className="space-y-2">
              <p role="alert">{t("seatsCard.dialog.previewError")}</p>
              <Button
                loading={preview.isFetching}
                onClick={() => void preview.refetch()}
                size="sm"
                variant="outline"
              >
                {t("seatsCard.dialog.previewRetry")}
              </Button>
            </div>
          ) : null}
          {preview.data ? (
            <dl className="space-y-2">
              {isAdding ? (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {t("seatsCard.dialog.dueNow")}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {t("seatsCard.dialog.approximate", {
                      amount: formatAmount(
                        preview.data.amountDue,
                        preview.data.currency,
                      ),
                    })}
                  </dd>
                </div>
              ) : null}
              {preview.data.effectiveAt ? (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {t("seatsCard.dialog.effectiveAt")}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {formatter.dateTime(preview.data.effectiveAt, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("seatsCard.dialog.newMonthly")}
                  <span className="block text-xs">
                    {t("seatsCard.dialog.newMonthlyHint")}
                  </span>
                </dt>
                <dd className="font-medium tabular-nums">
                  {formatAmount(
                    preview.data.newMonthlyAmount,
                    preview.data.currency,
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
          {seatsLost > 0 ? (
            <p className="font-medium">
              {t("seatsCard.dialog.seatsLost", { count: seatsLost })}
            </p>
          ) : null}
          {scheduledCancelDate && isAdding ? (
            <p className="text-muted-foreground">
              {t("seatsCard.dialog.cancellationNote", {
                date: formatter.dateTime(scheduledCancelDate, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }),
              })}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isUpdating}>
            {t("seatsCard.dialog.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className={
              seatsLost > 0
                ? buttonVariants({ variant: "destructive" })
                : undefined
            }
            disabled={!preview.data}
            loading={isUpdating}
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
