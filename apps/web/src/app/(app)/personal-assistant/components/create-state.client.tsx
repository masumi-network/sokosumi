"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { AuroraOrb } from "@/components/aurora-orb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSokoBotAction } from "@/lib/actions/soko-bot/action";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type { SokoBotAvatar } from "@/lib/clients/generated/core";

import { AvatarPicker } from "./avatar-picker.client";

/**
 * First visit: the bot's orb, what it does, a name, and a picture.
 * Core upserts on the user, so this also reactivates an archived bot.
 */
export function CreateState({ userId }: { userId: string }) {
  const t = useTranslations("App.SokoBot.Create");
  const tChat = useTranslations("App.SokoBot.Chat");
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<SokoBotAvatar | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createSokoBotAction({
        input: { name: trimmed, avatarId: avatar?.id ?? null },
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
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-12 md:py-20">
      {avatar ? (
        <img
          src={avatar.imageUrl}
          alt={tChat("avatarAlt")}
          className="ring-border/40 size-24 rounded-full object-cover ring-1"
        />
      ) : (
        <AuroraOrb
          seed={defaultOrbSeed(userId)}
          size={160}
          animate
          expression="happy"
          alt={tChat("avatarAlt")}
          className="ring-border/40 size-24 ring-1"
        />
      )}
      <h1 className="text-foreground mt-6 text-center text-2xl font-semibold tracking-tight text-balance md:text-3xl">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-md text-center text-sm leading-relaxed text-pretty md:text-base">
        {t("description")}
      </p>

      <form onSubmit={handleSubmit} className="mt-10 w-full space-y-6">
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
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label>{t("avatarLabel")}</Label>
          <AvatarPicker value={avatar?.id ?? null} onChange={setAvatar} />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isPending || name.trim().length === 0}
        >
          {isPending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
