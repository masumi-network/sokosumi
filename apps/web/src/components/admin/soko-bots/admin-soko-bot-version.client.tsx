"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { setAdminSokoBotVersionAction } from "@/lib/actions/admin-soko-bots/action";
import { newOperationId } from "@/lib/soko-bot/operation-id";

interface AdminSokoBotVersionProps {
  sokoBotId: string;
  currentVersionId: string | null;
  versions: { id: string; name: string }[];
  defaultVersionId: string;
}

/**
 * Moves one bot onto another version.
 *
 * Promoting a version only decides what new bots are created on, so an
 * existing bot stays where it is until somebody moves it. Same audited path as
 * the other operator actions: a reason is required and Core records the
 * before and after.
 */
export function AdminSokoBotVersion({
  sokoBotId,
  currentVersionId,
  versions,
  defaultVersionId,
}: AdminSokoBotVersionProps) {
  const t = useTranslations("App.Admin.SokoBots.Version");
  const router = useRouter();
  const reasonId = useId();
  const versionFieldId = useId();
  const [target, setTarget] = useState(currentVersionId ?? defaultVersionId);
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(() => newOperationId());
  const [isPending, startTransition] = useTransition();

  const unchanged = target === currentVersionId;

  function apply() {
    startTransition(async () => {
      const result = await setAdminSokoBotVersionAction({
        input: {
          sokoBotId,
          versionId: target,
          reason: reason.trim(),
          operationId,
        },
      });
      if (!result.ok) {
        // The operation id survives a failure so a retry is the same
        // operation to Core rather than a second one.
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(t("done", { version: target }));
      setReason("");
      setOperationId(newOperationId());
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium text-sm">{t("title")}</h2>
        <p className="text-muted-foreground text-xs">{t("description")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={versionFieldId}>{t("versionLabel")}</Label>
        <Select value={target} onValueChange={setTarget} disabled={isPending}>
          <SelectTrigger id={versionFieldId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {versions.map((version) => (
              <SelectItem key={version.id} value={version.id}>
                {version.id === defaultVersionId
                  ? t("defaultOption", { name: version.name })
                  : version.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {currentVersionId
            ? t("current", { version: currentVersionId })
            : t("currentUnset")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={reasonId}>{t("reasonLabel")}</Label>
        <Textarea
          id={reasonId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder={t("reasonPlaceholder")}
          required
        />
      </div>

      <Button
        type="button"
        size="sm"
        onClick={apply}
        disabled={isPending || unchanged || reason.trim().length < 3}
      >
        {isPending ? t("working") : t("confirm")}
      </Button>
    </section>
  );
}
