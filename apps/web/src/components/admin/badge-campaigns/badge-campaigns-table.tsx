"use client";

import type { BadgeCampaign } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteAdminBadgeCampaignAction,
  endAdminBadgeCampaignAction,
  startAdminBadgeCampaignAction,
} from "@/lib/actions/admin-badge-campaigns/action";

import {
  type AnnouncedFeatureLabels,
  BadgeCampaignForm,
} from "./badge-campaign-form";

export type BadgeCampaignStatus = "scheduled" | "live" | "ended";

export interface BadgeCampaignRow {
  campaign: BadgeCampaign;
  /** Resolved on the server, so the table renders the same on both sides. */
  status: BadgeCampaignStatus;
}

export function BadgeCampaignsTable({
  rows,
  featureLabels,
}: {
  rows: BadgeCampaignRow[];
  featureLabels: AnnouncedFeatureLabels;
}) {
  const t = useTranslations("App.Admin.BadgeCampaigns");
  const formatter = useFormatter();
  const [editing, setEditing] = useState<BadgeCampaign | null>(null);
  const [isPending, startTransition] = useTransition();

  // The reader's own time zone, the one the rest of the app uses.
  function formatDate(date: Date) {
    return formatter.dateTime(date, "dateTimeMedium");
  }

  function handleStartNow(campaign: BadgeCampaign) {
    startTransition(async () => {
      const result = await startAdminBadgeCampaignAction({
        input: { id: campaign.id },
      });
      if (!result.ok) {
        toast.error(t("Toasts.saveFailed"), {
          description: result.error.message,
        });
        return;
      }
      toast.success(t("Toasts.started"));
    });
  }

  function handleEndNow(campaign: BadgeCampaign) {
    startTransition(async () => {
      const result = await endAdminBadgeCampaignAction({
        input: { id: campaign.id },
      });
      if (!result.ok) {
        toast.error(t("Toasts.saveFailed"), {
          description: result.error.message,
        });
        return;
      }
      toast.success(t("Toasts.ended"));
    });
  }

  function handleDelete(campaign: BadgeCampaign) {
    startTransition(async () => {
      const result = await deleteAdminBadgeCampaignAction({
        input: { id: campaign.id },
      });
      if (!result.ok) {
        toast.error(t("Toasts.deleteFailed"), {
          description: result.error.message,
        });
        return;
      }
      toast.success(t("Toasts.deleted"));
    });
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("Table.empty")}</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Table.feature")}</TableHead>
            <TableHead>{t("Table.startsAt")}</TableHead>
            <TableHead>{t("Table.endsAt")}</TableHead>
            <TableHead>{t("Table.status")}</TableHead>
            <TableHead className="text-right">{t("Table.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ campaign, status }) => (
            <TableRow key={campaign.id}>
              <TableCell className="font-medium">
                {featureLabels[campaign.feature]}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatDate(campaign.startsAt)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatDate(campaign.endsAt)}
              </TableCell>
              <TableCell>
                <Badge variant={status === "live" ? "default" : "outline"}>
                  {t(`Status.${status}`)}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setEditing(campaign)}
                  >
                    {t("Actions.edit")}
                  </Button>
                  {status === "live" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => handleEndNow(campaign)}
                    >
                      {t("Actions.endNow")}
                    </Button>
                  ) : null}
                  {status === "scheduled" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => handleStartNow(campaign)}
                    >
                      {t("Actions.startNow")}
                    </Button>
                  ) : null}
                  {status === "scheduled" ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isPending}
                      onClick={() => handleDelete(campaign)}
                    >
                      {t("Actions.delete")}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Form.editTitle")}</DialogTitle>
            <DialogDescription>
              {editing ? featureLabels[editing.feature] : null}
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <BadgeCampaignForm
              featureLabels={featureLabels}
              campaign={editing}
              onSaved={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
