"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addAdminExternalChannelGuestAction } from "@/lib/actions/admin-external-channels/action";
import { searchUsersClient } from "@/lib/actions/admin-search/client";
import type { AdminExternalChannelDetail } from "@/lib/clients/generated/core";
import type { AdminUserOption } from "@/lib/services/admin-user.service";

interface ExternalChannelDetailPanelProps {
  organizationSlug: string;
  organizationName: string;
  channel: AdminExternalChannelDetail;
}

export function ExternalChannelDetailPanel({
  organizationSlug,
  organizationName,
  channel,
}: ExternalChannelDetailPanelProps) {
  const t = useTranslations("App.Admin.ExternalChannels.Detail");
  const tUser = useTranslations("Components.UserCombobox");
  const router = useRouter();
  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const userLabels = buildComboboxLabels(tUser);

  async function handleAddGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) {
      toast.error(t("guestRequired"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await addAdminExternalChannelGuestAction({
        input: {
          organizationSlug,
          roomId: channel.id,
          userId: selectedUser.id,
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("addGuestError"));
        return;
      }
      toast.success(
        result.value.outcome === "already_guest"
          ? t("alreadyGuest")
          : t("addGuestSuccess"),
      );
      setSelectedUser(null);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {channel.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("hostLabel", { org: organizationName, slug: channel.slug })}
          </p>
          {channel.topic ? (
            <p className="text-muted-foreground text-sm">{channel.topic}</p>
          ) : null}
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/external-channels">{t("back")}</Link>
        </Button>
      </div>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("Guests.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("Guests.description")}
          </p>
        </div>
        {channel.guests.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("Guests.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Guests.name")}</TableHead>
                <TableHead>{t("Guests.email")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channel.guests.map((guest) => (
                <TableRow key={guest.userId}>
                  <TableCell>{guest.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {guest.email}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <form onSubmit={handleAddGuest} className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("AddGuest.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("AddGuest.description")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="guest-user">{t("AddGuest.user")}</Label>
          <AsyncSearchCombobox<AdminUserOption>
            id="guest-user"
            value={selectedUser}
            onChange={setSelectedUser}
            search={searchUsersClient}
            getKey={(user) => user.id}
            getTriggerLabel={(user) => user.name}
            renderOption={(user) => (
              <span className="flex flex-col">
                <span>{user.name}</span>
                <span className="text-muted-foreground text-xs">
                  {user.email}
                </span>
              </span>
            )}
            labels={userLabels}
          />
        </div>
        <Button type="submit" disabled={isSubmitting || !selectedUser}>
          {isSubmitting ? t("AddGuest.submitting") : t("AddGuest.submit")}
        </Button>
      </form>
    </div>
  );
}
