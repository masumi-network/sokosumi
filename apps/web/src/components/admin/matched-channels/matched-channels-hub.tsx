"use client";

import {
  CHANNEL_SLUG_MAX_LENGTH,
  CORE_API_ERROR_KINDS,
  channelNameFromSlug,
  liveSanitizeChannelSlug,
  sanitizeChannelSlug,
} from "@sokosumi/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createAdminMatchedChannelAction,
  listAdminMatchedChannelsAction,
} from "@/lib/actions/admin-matched-channels/action";
import type { AdminMatchedChannelOption } from "@/lib/clients/generated/core";

const CHANNEL_NAME_MAX = 80;

type ListStatus = "active" | "archived";

export function MatchedChannelsHub() {
  const t = useTranslations("App.Admin.MatchedChannels");
  const router = useRouter();

  const [listStatus, setListStatus] = useState<ListStatus>("active");
  const [channels, setChannels] = useState<AdminMatchedChannelOption[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [channelName, setChannelName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [channelSlug, setChannelSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingChannels(true);
    void listAdminMatchedChannelsAction({
      input: { status: listStatus },
    }).then((result) => {
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
  }, [listStatus, t]);

  function handleSlugChange(raw: string) {
    const slug = liveSanitizeChannelSlug(raw).slice(0, CHANNEL_SLUG_MAX_LENGTH);
    setChannelSlug(slug);
    if (!nameDirty) {
      setChannelName(channelNameFromSlug(sanitizeChannelSlug(slug)));
    }
  }

  function handleNameChange(raw: string) {
    setNameDirty(true);
    setChannelName(raw.slice(0, CHANNEL_NAME_MAX));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const slug = sanitizeChannelSlug(channelSlug);
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
        toast.error(
          result.error.code === CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN
            ? t("Create.slugTaken")
            : (result.error.message ?? t("Create.error")),
        );
        return;
      }
      toast.success(t("Create.success"));
      setChannelName("");
      setNameDirty(false);
      setChannelSlug("");
      router.push(`/admin/matched-channels/${result.value.id}`);
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  const emptyMessage =
    listStatus === "archived" ? t("List.emptyArchived") : t("List.empty");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("List.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {listStatus === "archived"
              ? t("List.descriptionArchived")
              : t("List.description")}
          </p>
        </div>
        <Tabs
          value={listStatus}
          onValueChange={(value) => {
            if (value === "active" || value === "archived") {
              setListStatus(value);
            }
          }}
        >
          <TabsList>
            <TabsTrigger value="active">{t("List.tabActive")}</TabsTrigger>
            <TabsTrigger value="archived">{t("List.tabArchived")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {isLoadingChannels ? (
          <p className="text-muted-foreground text-sm">{t("List.loading")}</p>
        ) : channels.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
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

      {listStatus === "active" ? (
        <>
          <Separator />

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-medium">{t("Create.title")}</h2>
              <p className="text-muted-foreground text-sm">
                {t("Create.description")}
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="channel-slug">{t("Create.slug")}</Label>
                <div className="relative">
                  <span
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm"
                    aria-hidden
                  >
                    #
                  </span>
                  <Input
                    id="channel-slug"
                    value={channelSlug}
                    onChange={(event) => handleSlugChange(event.target.value)}
                    maxLength={CHANNEL_SLUG_MAX_LENGTH}
                    required
                    placeholder={t("Create.slugPlaceholder")}
                    className="pl-7"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("Create.slugHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="channel-name">{t("Create.name")}</Label>
                <Input
                  id="channel-name"
                  value={channelName}
                  onChange={(event) => handleNameChange(event.target.value)}
                  maxLength={CHANNEL_NAME_MAX}
                  placeholder={t("Create.namePlaceholder")}
                  autoComplete="off"
                />
                <p className="text-muted-foreground text-xs">
                  {t("Create.nameHelp")}
                </p>
              </div>
            </div>
            <Button type="submit" disabled={isCreating || !channelSlug}>
              {isCreating ? t("Create.submitting") : t("Create.submit")}
            </Button>
          </form>
        </>
      ) : null}
    </div>
  );
}
