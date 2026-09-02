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
import { migrateAdminSokoBotVersionsAction } from "@/lib/actions/admin-soko-bots/action";
import type { AdminSokoBotVersionMigrationResult } from "@/lib/clients/generated/core";

interface SokoBotVersionMigrationProps {
  versions: { id: string; name: string }[];
  defaultVersionId: string;
  /**
   * Every version the live fleet runs, counted in Core rather than from a page
   * of bots, so the number on the button is the number that moves.
   */
  inUse: { versionId: string; count: number }[];
}

const EVERY_BOT = "__all__";

/**
 * Moves many bots onto one version.
 *
 * Deliberately not part of promotion: promoting decides what new bots are
 * created on and leaves the existing fleet where it is, which is the right
 * default but means nothing moves until somebody says so here.
 */
export function SokoBotVersionMigration({
  versions,
  defaultVersionId,
  inUse,
}: SokoBotVersionMigrationProps) {
  const t = useTranslations("App.Admin.SokoBots.Migration");
  const router = useRouter();
  const fromId = useId();
  const toId = useId();
  const reasonId = useId();
  const [from, setFrom] = useState<string>(EVERY_BOT);
  const [to, setTo] = useState(defaultVersionId);
  const [reason, setReason] = useState("");
  const [result, setResult] =
    useState<AdminSokoBotVersionMigrationResult | null>(null);
  const [isPending, startTransition] = useTransition();

  // What this will touch, before it touches it: an operator should not have to
  // run the migration to find out how many bots it moves.
  const affected =
    from === EVERY_BOT
      ? inUse
          .filter((entry) => entry.versionId !== to)
          .reduce((total, entry) => total + entry.count, 0)
      : from === to
        ? 0
        : (inUse.find((entry) => entry.versionId === from)?.count ?? 0);

  function migrate() {
    startTransition(async () => {
      const outcome = await migrateAdminSokoBotVersionsAction({
        input: {
          ...(from === EVERY_BOT ? {} : { fromVersionId: from }),
          toVersionId: to,
          reason: reason.trim(),
        },
      });
      if (!outcome.ok) {
        toast.error(outcome.error.message ?? t("error"));
        return;
      }
      setResult(outcome.value);
      setReason("");
      toast.success(t("done", { moved: outcome.value.moved }));
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium text-sm">{t("title")}</h2>
        <p className="text-muted-foreground text-xs">{t("description")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={fromId}>{t("fromLabel")}</Label>
          <Select value={from} onValueChange={setFrom} disabled={isPending}>
            <SelectTrigger id={fromId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERY_BOT}>{t("everyBot")}</SelectItem>
              {inUse.map((entry) => (
                <SelectItem key={entry.versionId} value={entry.versionId}>
                  {t("inUseOption", {
                    version: entry.versionId,
                    count: entry.count,
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={toId}>{t("toLabel")}</Label>
          <Select value={to} onValueChange={setTo} disabled={isPending}>
            <SelectTrigger id={toId} className="w-full">
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
        </div>
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

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={migrate}
          disabled={isPending || affected === 0 || reason.trim().length < 3}
        >
          {isPending ? t("working") : t("confirm", { count: affected })}
        </Button>
        {affected === 0 && (
          <p className="text-muted-foreground text-xs">{t("nothingToMove")}</p>
        )}
      </div>

      {result && (
        <div className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
          <p>
            {t("result", {
              moved: result.moved,
              alreadyOnVersion: result.alreadyOnVersion,
              failed: result.failed,
            })}
          </p>
          {/* Named, so a partial run says which bots still need a look. */}
          {result.failures.length > 0 && (
            <ul className="space-y-1 text-destructive">
              {result.failures.map((failure) => (
                <li key={failure.sokoBotId}>
                  {failure.sokoBotId}: {failure.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
