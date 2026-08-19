"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { performAdminSokoBotAction } from "@/lib/actions/admin-soko-bots/action";
import type { SokoBotStatus } from "@/lib/clients/generated/core";
import {
  ADMIN_SOKO_BOT_ACTIONS,
  type AdminSokoBotActionKind,
} from "@/lib/soko-bot/constants";
import { newOperationId } from "@/lib/soko-bot/operation-id";

interface AdminSokoBotActionsProps {
  sokoBotId: string;
  status: SokoBotStatus;
  /** Set only by an operator PAUSE; user archive also yields PAUSED status. */
  adminPausedAt?: Date | null;
  hasFailedTurn: boolean;
}

const DESTRUCTIVE: ReadonlySet<AdminSokoBotActionKind> = new Set([
  "RESET_SESSION",
  "RESET_MEMORY",
]);

/**
 * Operator controls. Every action requires a reason and is recorded by Core
 * as an immutable admin audit entry.
 */
export function AdminSokoBotActions({
  sokoBotId,
  status,
  adminPausedAt = null,
  hasFailedTurn,
}: AdminSokoBotActionsProps) {
  const t = useTranslations("App.Admin.SokoBots.Actions");
  const router = useRouter();
  const reasonId = useId();
  const [selected, setSelected] = useState<AdminSokoBotActionKind | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const availability: Record<AdminSokoBotActionKind, boolean> = {
    PAUSE: status !== "PAUSED" && adminPausedAt === null,
    RESUME: adminPausedAt !== null,
    RESET_SESSION: true,
    RESET_MEMORY: true,
    RETRY_LAST_FAILED: hasFailedTurn,
  };

  function select(action: AdminSokoBotActionKind) {
    // New action → new operation. Retries of the same dialog keep the id.
    setSelected(action);
    setOperationId(newOperationId());
  }

  function close() {
    if (isPending) return;
    setSelected(null);
    setOperationId(null);
    setReason("");
  }

  function confirm() {
    if (!selected) return;
    startTransition(async () => {
      const result = await performAdminSokoBotAction({
        input: {
          sokoBotId,
          action: selected,
          reason: reason.trim(),
          operationId: operationId ?? newOperationId(),
        },
      });
      if (!result.ok) {
        // Keep operationId so a retry is idempotent on Core.
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(t("done", { action: t(`labels.${selected}`) }));
      setSelected(null);
      setOperationId(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t("group")}
      >
        {ADMIN_SOKO_BOT_ACTIONS.map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={DESTRUCTIVE.has(action) ? "destructive" : "outline"}
            disabled={!availability[action] || isPending}
            onClick={() => select(action)}
          >
            {t(`labels.${action}`)}
          </Button>
        ))}
      </div>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected ? t(`labels.${selected}`) : ""}</DialogTitle>
            <DialogDescription>
              {selected ? t(`descriptions.${selected}`) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={reasonId}>{t("reasonLabel")}</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              required
            />
            <p className="text-muted-foreground text-xs">{t("reasonHint")}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={close}
              disabled={isPending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant={
                selected && DESTRUCTIVE.has(selected)
                  ? "destructive"
                  : "default"
              }
              onClick={confirm}
              disabled={isPending || reason.trim().length < 3}
            >
              {isPending ? t("working") : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
