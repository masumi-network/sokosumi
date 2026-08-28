"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  createAdminExternalChannelAction,
  listAdminExternalChannelsAction,
} from "@/lib/actions/admin-external-channels/action";
import { searchOrganizationsClient } from "@/lib/actions/admin-search/client";
import type { AdminExternalChannelOption } from "@/lib/clients/generated/core";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import { favorAdminMemberOrganizations } from "@/lib/utils/favor-admin-member-organizations";

interface ExternalChannelsHubProps {
  memberOrganizationIds: string[];
}

export function ExternalChannelsHub({
  memberOrganizationIds,
}: ExternalChannelsHubProps) {
  const t = useTranslations("App.Admin.ExternalChannels");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const router = useRouter();

  const [selectedOrg, setSelectedOrg] =
    useState<AdminOrganizationOption | null>(null);
  const [channels, setChannels] = useState<AdminExternalChannelOption[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelSlug, setChannelSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const orgLabels = buildComboboxLabels(tOrg);

  const searchOrganizations = useCallback(
    async (query: string) => {
      const results = await searchOrganizationsClient(query);
      return favorAdminMemberOrganizations(
        results,
        new Set(memberOrganizationIds),
      );
    },
    [memberOrganizationIds],
  );

  useEffect(() => {
    if (!selectedOrg) {
      setChannels([]);
      return;
    }

    let cancelled = false;
    setIsLoadingChannels(true);
    void listAdminExternalChannelsAction({
      input: { organizationSlug: selectedOrg.slug },
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
  }, [selectedOrg, t]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrg) {
      toast.error(t("hostOrgRequired"));
      return;
    }

    const slug = channelSlug.trim();
    if (!slug) {
      toast.error(t("Create.slugRequired"));
      return;
    }

    setIsCreating(true);
    try {
      const name = channelName.trim();
      const result = await createAdminExternalChannelAction({
        input: {
          organizationSlug: selectedOrg.slug,
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
      router.push(
        `/admin/external-channels/${encodeURIComponent(selectedOrg.slug)}/${result.value.id}`,
      );
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Label htmlFor="host-org">{t("hostOrganization")}</Label>
        <AsyncSearchCombobox<AdminOrganizationOption>
          id="host-org"
          value={selectedOrg}
          onChange={setSelectedOrg}
          search={searchOrganizations}
          getKey={(org) => org.id}
          getTriggerLabel={(org) => org.name}
          renderOption={(org) => (
            <span className="flex flex-col">
              <span>{org.name}</span>
              <span className="text-muted-foreground text-xs">{org.slug}</span>
            </span>
          )}
          labels={orgLabels}
        />
        <p className="text-muted-foreground text-xs">{t("hostOrgHelper")}</p>
      </div>

      {selectedOrg ? (
        <>
          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-lg font-medium">{t("List.title")}</h2>
              <p className="text-muted-foreground text-sm">
                {t("List.description", { org: selectedOrg.name })}
              </p>
            </div>
            {isLoadingChannels ? (
              <p className="text-muted-foreground text-sm">
                {t("List.loading")}
              </p>
            ) : channels.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("List.empty")}</p>
            ) : (
              <ul className="divide-border divide-y rounded-md border">
                {channels.map((channel) => (
                  <li key={channel.id}>
                    <Link
                      href={`/admin/external-channels/${encodeURIComponent(selectedOrg.slug)}/${channel.id}`}
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
        </>
      ) : null}
    </div>
  );
}
