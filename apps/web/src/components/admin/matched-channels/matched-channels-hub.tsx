"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  createAdminMatchedChannelAction,
  listAdminMatchedChannelsAction,
} from "@/lib/actions/admin-matched-channels/action";
import type { AdminMatchedChannelOption } from "@/lib/clients/generated/core";

export function MatchedChannelsHub() {
  const t = useTranslations("App.Admin.MatchedChannels");
  const router = useRouter();

  const [channels, setChannels] = useState<AdminMatchedChannelOption[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [channelName, setChannelName] = useState("");
  const [channelSlug, setChannelSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingChannels(true);
    void listAdminMatchedChannelsAction({}).then((result) => {
      if (cancelled) {
        return;
      }
      setIsLoadingChannels(false);
      if (!result.ok) {
        toast.error(result.error.message ?? t("listError"));
        setChannels([]);
        return;
      }
      setChannels(result.value);
    });

    return () => {
      cancelled = true;
    };
  }, [t]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const slug = channelSlug.trim();
    if (!slug) {
      toast.error(t("Create.slugRequired"));
      return;
    }

    setIsCreating(true);
    try {
      const name = channelName.trim();
      const result = await createAdminMatchedChannelAction({
        input: {
          slug,
          ...(name ? { name } : {}),
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Create.error"));
        return;
      }
      toast.success(t("Create.success"));
      setChannelName("");
      setChannelSlug("");
      router.push(`/admin/matched-channels/${result.value.id}`);
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("List.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("List.description")}
          </p>
        </div>
        {isLoadingChannels ? (
          <p className="text-muted-foreground text-sm">{t("List.loading")}</p>
        ) : channels.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("List.empty")}</p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {channels.map((channel) => (
              <li key={channel.id}>
                <Link
                  href={`/admin/matched-channels/${channel.id}`}
                  className="hover:bg-muted/50 flex flex-col gap-0.5 px-4 py-3 transition-colors"
                >
                  <span className="font-medium">{channel.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {channel.slug}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      <form onSubmit={handleCreate} className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("Create.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("Create.description")}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="channel-name">{t("Create.name")}</Label>
            <Input
              id="channel-name"
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              maxLength={80}
              placeholder={t("Create.namePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel-slug">{t("Create.slug")}</Label>
            <Input
              id="channel-slug"
              value={channelSlug}
              onChange={(event) => setChannelSlug(event.target.value)}
              maxLength={80}
              required
              placeholder={t("Create.slugPlaceholder")}
            />
          </div>
        </div>
        <Button type="submit" disabled={isCreating}>
          {isCreating ? t("Create.submitting") : t("Create.submit")}
        </Button>
      </form>
    </div>
  );
}
