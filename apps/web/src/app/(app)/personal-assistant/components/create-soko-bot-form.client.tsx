"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSokoBotAction } from "@/lib/actions/soko-bot/action";
import { SokoBotAutonomyLevel } from "@/lib/clients/generated/core";

import { AutonomyRadioGroup } from "./autonomy-radio-group.client";

/**
 * Names the bot and picks an autonomy level. Core upserts on the user, so
 * this also reactivates a previously archived bot.
 */
export function CreateSokoBotForm() {
  const t = useTranslations("App.SokoBot.Create");
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState("");
  const [autonomyLevel, setAutonomyLevel] = useState<SokoBotAutonomyLevel>(
    SokoBotAutonomyLevel.MEDIUM,
  );
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createSokoBotAction({
        input: { name: trimmed, autonomyLevel },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(t("created"));
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-background space-y-6 rounded-md border p-4"
    >
      <div className="space-y-2">
        <Label htmlFor={nameId}>{t("nameLabel")}</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder={t("namePlaceholder")}
          required
          autoComplete="off"
        />
      </div>

      <AutonomyRadioGroup value={autonomyLevel} onChange={setAutonomyLevel} />

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || name.trim().length === 0}>
          {isPending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
