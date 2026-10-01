"use client";

import type { SokoBotAvatar } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { AvatarPicker } from "@/app/personal-assistant/components/avatar-picker.client";
import { Button } from "@/components/ui/button";
import { setAdminSokoBotAvatarAction } from "@/lib/actions/admin-soko-bots/action";

/** Gives another user's bot a mascot from the same pool the owner picks from. */
export function AdminSokoBotAvatar({
  sokoBotId,
  currentImageUrl,
}: {
  sokoBotId: string;
  currentImageUrl: string | null;
}) {
  const t = useTranslations("App.Admin.SokoBots.Avatar");
  const router = useRouter();
  const [picked, setPicked] = useState<SokoBotAvatar | null>(null);
  const [isPending, startTransition] = useTransition();

  function apply() {
    if (!picked) return;
    startTransition(async () => {
      const result = await setAdminSokoBotAvatarAction({
        input: { sokoBotId, avatarId: picked.id },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(t("done"));
      setPicked(null);
      router.refresh();
    });
  }

  return (
    <section id="avatar" className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium text-sm">{t("title")}</h2>
        <p className="text-muted-foreground text-xs">{t("description")}</p>
      </div>
      <AvatarPicker
        value={picked?.id ?? null}
        onChange={setPicked}
        currentImageUrl={currentImageUrl}
      />
      <Button size="sm" disabled={!picked || isPending} onClick={apply}>
        {t("apply")}
      </Button>
    </section>
  );
}
