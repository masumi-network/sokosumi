"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useState } from "react";
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
import {
  addAdminMatchedChannelParticipantAction,
  addAdminMatchedChannelParticipantsFromOrganizationAction,
  removeAdminMatchedChannelParticipantAction,
} from "@/lib/actions/admin-matched-channels/action";
import {
  searchOrganizationsClient,
  searchUsersClient,
} from "@/lib/actions/admin-search/client";
import type { AdminMatchedChannelDetail } from "@/lib/clients/generated/core";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";
import { favorAdminMemberOrganizations } from "@/lib/utils/favor-admin-member-organizations";

interface MatchedChannelDetailPanelProps {
  channel: AdminMatchedChannelDetail;
  memberOrganizationIds: string[];
}

export function MatchedChannelDetailPanel({
  channel,
  memberOrganizationIds,
}: MatchedChannelDetailPanelProps) {
  const t = useTranslations("App.Admin.MatchedChannels.Detail");
  const tUser = useTranslations("Components.UserCombobox");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const router = useRouter();

  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [selectedOrg, setSelectedOrg] =
    useState<AdminOrganizationOption | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isAddingOrg, setIsAddingOrg] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  const userLabels = buildComboboxLabels(tUser);
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

  async function handleAddUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) {
      toast.error(t("userRequired"));
      return;
    }

    setIsAddingUser(true);
    try {
      const result = await addAdminMatchedChannelParticipantAction({
        input: {
          roomId: channel.id,
          userId: selectedUser.id,
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("addUserError"));
        return;
      }
      toast.success(
        result.value.outcome === "already_member"
          ? t("alreadyMember")
          : t("addUserSuccess"),
      );
      setSelectedUser(null);
      router.refresh();
    } finally {
      setIsAddingUser(false);
    }
  }

  async function handleAddOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrg) {
      toast.error(t("organizationRequired"));
      return;
    }

    setIsAddingOrg(true);
    try {
      const result =
        await addAdminMatchedChannelParticipantsFromOrganizationAction({
          input: {
            roomId: channel.id,
            organizationId: selectedOrg.id,
          },
        });
      if (!result.ok) {
        toast.error(result.error.message ?? t("addOrganizationError"));
        return;
      }
      toast.success(
        t("addOrganizationSuccess", {
          added: result.value.added,
          alreadyMember: result.value.alreadyMember,
          totalMembers: result.value.totalMembers,
        }),
      );
      setSelectedOrg(null);
      router.refresh();
    } finally {
      setIsAddingOrg(false);
    }
  }

  async function handleRemoveUser(userId: string, name: string) {
    setRemovingUserId(userId);
    try {
      const result = await removeAdminMatchedChannelParticipantAction({
        input: {
          roomId: channel.id,
          userId,
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Roster.removeError"));
        return;
      }
      toast.success(t("Roster.removeSuccess", { name }));
      router.refresh();
    } finally {
      setRemovingUserId(null);
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
            {t("slugLabel", { slug: channel.slug })}
          </p>
          {channel.topic ? (
            <p className="text-muted-foreground text-sm">{channel.topic}</p>
          ) : null}
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/matched-channels">{t("back")}</Link>
        </Button>
      </div>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("Roster.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("Roster.description")}
          </p>
        </div>
        {channel.participants.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("Roster.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Roster.name")}</TableHead>
                <TableHead>{t("Roster.email")}</TableHead>
                <TableHead className="w-[1%] text-right">
                  <span className="sr-only">{t("Roster.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channel.participants.map((participant) => (
                <TableRow key={participant.userId}>
                  <TableCell>{participant.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {participant.email}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={removingUserId === participant.userId}
                      onClick={() =>
                        void handleRemoveUser(
                          participant.userId,
                          participant.name,
                        )
                      }
                    >
                      {removingUserId === participant.userId
                        ? t("Roster.removing")
                        : t("Roster.remove")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <form onSubmit={handleAddUser} className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("AddUser.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("AddUser.description")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="participant-user">{t("AddUser.user")}</Label>
          <AsyncSearchCombobox<AdminUserOption>
            id="participant-user"
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
        <Button type="submit" disabled={isAddingUser || !selectedUser}>
          {isAddingUser ? t("AddUser.submitting") : t("AddUser.submit")}
        </Button>
      </form>

      <form onSubmit={handleAddOrganization} className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("AddOrganization.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("AddOrganization.description")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="snapshot-org">
            {t("AddOrganization.organization")}
          </Label>
          <AsyncSearchCombobox<AdminOrganizationOption>
            id="snapshot-org"
            value={selectedOrg}
            onChange={setSelectedOrg}
            search={searchOrganizations}
            getKey={(org) => org.id}
            getTriggerLabel={(org) => org.name}
            renderOption={(org) => (
              <span className="flex flex-col">
                <span>{org.name}</span>
                <span className="text-muted-foreground text-xs">
                  {org.slug}
                </span>
              </span>
            )}
            labels={orgLabels}
          />
          <p className="text-muted-foreground text-xs">
            {t("AddOrganization.helper")}
          </p>
        </div>
        <Button type="submit" disabled={isAddingOrg || !selectedOrg}>
          {isAddingOrg
            ? t("AddOrganization.submitting")
            : t("AddOrganization.submit")}
        </Button>
      </form>
    </div>
  );
}
