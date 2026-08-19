"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { updateSokoBotAutonomyAction } from "@/lib/actions/soko-bot/action";
import type { SokoBotAutonomyLevel } from "@/lib/clients/generated/core";

import { AutonomyRadioGroup } from "./autonomy-radio-group.client";

export function AutonomySettings({
  current,
}: {
  current: SokoBotAutonomyLevel;
}) {
  const t = useTranslations("App.SokoBot.Autonomy");
  const router = useRouter();
  const [value, setValue] = useState<SokoBotAutonomyLevel>(current);
  const [isPending, startTransition] = useTransition();
  const dirty = value !== current;

  return (
    <div className="space-y-3">
      <AutonomyRadioGroup value={value} onChange={setValue} compact />
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!dirty || isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await updateSokoBotAutonomyAction({
                autonomyLevel: value,
              });
              if (!result.ok) {
                toast.error(result.error.message ?? t("error"));
                return;
              }
              toast.success(t("saved"));
              router.refresh();
            })
          }
        >
          {isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
