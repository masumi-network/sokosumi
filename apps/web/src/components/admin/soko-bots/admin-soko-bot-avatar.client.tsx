"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { BotFace } from "@/components/soko-bot/bot-face";
import { Button } from "@/components/ui/button";
import { setAdminSokoBotAvatarCodeAction } from "@/lib/actions/admin-soko-bots/action";

/** Loaded on open: it carries the 16 traced animals. */
const AvatarStudioDialog = dynamic(
  () =>
    import("@/app/personal-assistant/components/avatar-studio.client").then(
      (m) => ({ default: m.AvatarStudioDialog }),
    ),
  { ssr: false },
);

/** Gives another user's bot a look in the same avatar studio its owner uses. */
export function AdminSokoBotAvatar({
  sokoBotId,
  avatarCode,
  avatarImageUrl,
  seed,
}: {
  sokoBotId: string;
  avatarCode: string | null;
  avatarImageUrl: string | null;
  seed: string;
}) {
  const t = useTranslations("App.Admin.SokoBots.Avatar");
  const tAvatar = useTranslations("App.SokoBot.Avatar");
  const [open, setOpen] = useState(false);

  return (
    <section id="avatar" className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium text-sm">{t("title")}</h2>
        <p className="text-muted-foreground text-xs">{t("description")}</p>
      </div>
      <div className="flex items-center gap-4">
        <BotFace
          imageUrl={avatarImageUrl}
          seed={seed}
          avatarCode={avatarCode}
          avatarSize={64}
          className="size-16"
        />
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {tAvatar("edit")}
        </Button>
      </div>
      {open ? (
        <AvatarStudioDialog
          open={open}
          onOpenChange={setOpen}
          initialCode={avatarCode}
          saveLook={(code) =>
            setAdminSokoBotAvatarCodeAction({ input: { sokoBotId, code } })
          }
        />
      ) : null}
    </section>
  );
}
