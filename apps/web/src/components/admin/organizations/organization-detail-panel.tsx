"use client";

import { MemberRole } from "@sokosumi/utils";
import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addAdminOrganizationMemberAction,
  assignAdminOrganizationMemberSeatAction,
  removeAdminOrganizationMemberAction,
  unassignAdminOrganizationMemberSeatAction,
  updateAdminOrganizationMemberRoleAction,
} from "@/lib/actions/admin-organizations/member-actions";
import { searchUsersClient } from "@/lib/actions/admin-search/client";
import type { AdminOrganizationOverviewDetail } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";

interface OrganizationDetailPanelProps {
  detail: AdminOrganizationOverviewDetail;
}

export function OrganizationDetailPanel({
  detail,
}: OrganizationDetailPanelProps) {
  const t = useTranslations("App.Admin.Organizations.OrganizationDetail");
  const formatter = useFormatter();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [selectedRole, setSelectedRole] = useState<
    "owner" | "admin" | "member"
  >("member");

  const showSeatManagement = detail.seatSummary.paidPlan != null;

  function refresh() {
    router.refresh();
  }

  function runMemberAction(
    action: () => Promise<{ ok: boolean; error?: { message?: string } }>,
    successMessage: string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error?.message ?? t("memberActionError"));
        return;
      }
      toast.success(successMessage);
      refresh();
    });
  }

  function handleAddMember() {
    if (!selectedUser) {
      toast.error(t("addMember.userRequired"));
      return;
    }

    runMemberAction(
      () =>
        addAdminOrganizationMemberAction({
          slug: detail.organization.slug,
          userId: selectedUser.id,
          role: selectedRole,
        }),
      t("addMember.success"),
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.organization.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {detail.organization.slug}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/organizations">{t("backToList")}</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="bg-muted/40 space-y-2 rounded-lg border p-4">
          <h2 className="font-medium">{t("billing.title")}</h2>
          <p className="text-sm">
            {t("billing.plan", { plan: detail.billingPlan.plan })}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("billing.mode", { mode: detail.billingPlan.mode })}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("billing.seats", {
              purchased: detail.billingPlan.purchasedSeats,
              assigned: detail.seatSummary.assignedCount,
              unused: detail.seatSummary.unusedSeats,
            })}
          </p>
          {detail.subscription ? (
            <p className="text-sm">
              {t("billing.subscription", {
                plan: detail.subscription.plan,
                status: detail.subscription.status,
              })}
            </p>
          ) : null}
          {detail.enterpriseContract ? (
            <p className="text-sm">
              {t("billing.enterprisePool", {
                credits: formatter.number(
                  detail.enterpriseContract.poolRemainingCredits,
                ),
              })}
            </p>
          ) : null}
        </section>

        <section className="bg-muted/40 space-y-2 rounded-lg border p-4">
          <h2 className="font-medium">{t("credits.title")}</h2>
          <p className="text-2xl font-semibold tabular-nums">
            {formatter.number(detail.totalCredits)}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("credits.description")}
          </p>
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-medium">{t("members.title")}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <AsyncSearchCombobox<AdminUserOption>
              value={selectedUser}
              onValueChange={setSelectedUser}
              onSearch={searchUsersClient}
              getOptionLabel={(user) => `${user.name} (${user.email})`}
              getOptionValue={(user) => user.id}
              labels={buildComboboxLabels((key) =>
                t(`addMember.combobox.${key}`),
              )}
              className="w-72"
            />
            <Select
              value={selectedRole}
              onValueChange={(value) =>
                setSelectedRole(value as "owner" | "admin" | "member")
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MemberRole.OWNER}>
                  {t("roles.owner")}
                </SelectItem>
                <SelectItem value={MemberRole.ADMIN}>
                  {t("roles.admin")}
                </SelectItem>
                <SelectItem value={MemberRole.MEMBER}>
                  {t("roles.member")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleAddMember}
              disabled={isPending || !selectedUser}
            >
              {t("addMember.submit")}
            </Button>
          </div>
        </div>

        <div
          className="overflow-hidden rounded-lg border"
          aria-busy={isPending}
        >
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">{t("members.user")}</TableHead>
                <TableHead>{t("members.role")}</TableHead>
                <TableHead className="text-right">
                  {t("members.credits")}
                </TableHead>
                <TableHead>{t("members.subscription")}</TableHead>
                {showSeatManagement ? (
                  <TableHead>{t("members.seat")}</TableHead>
                ) : null}
                <TableHead className="pr-4 text-right">
                  {t("members.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="pl-4">
                    <span className="flex flex-col">
                      <span className="font-medium">{member.user.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {member.user.email}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{member.role}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatter.number(member.credits)}
                  </TableCell>
                  <TableCell>
                    {member.subscriptionPlan ? (
                      <span className="flex items-center gap-2">
                        <span>{member.subscriptionPlan}</span>
                        {member.subscriptionStatus ? (
                          <Badge variant="outline">
                            {member.subscriptionStatus}
                          </Badge>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {showSeatManagement ? (
                    <TableCell>
                      {member.seatAssignedAt
                        ? t("members.seatAssigned")
                        : t("members.seatUnassigned")}
                    </TableCell>
                  ) : null}
                  <TableCell className="pr-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <Ellipsis className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            runMemberAction(
                              () =>
                                updateAdminOrganizationMemberRoleAction({
                                  slug: detail.organization.slug,
                                  memberId: member.id,
                                  role: MemberRole.OWNER,
                                }),
                              t("roleUpdateSuccess"),
                            )
                          }
                        >
                          {t("actions.makeOwner")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            runMemberAction(
                              () =>
                                updateAdminOrganizationMemberRoleAction({
                                  slug: detail.organization.slug,
                                  memberId: member.id,
                                  role: MemberRole.ADMIN,
                                }),
                              t("roleUpdateSuccess"),
                            )
                          }
                        >
                          {t("actions.makeAdmin")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            runMemberAction(
                              () =>
                                updateAdminOrganizationMemberRoleAction({
                                  slug: detail.organization.slug,
                                  memberId: member.id,
                                  role: MemberRole.MEMBER,
                                }),
                              t("roleUpdateSuccess"),
                            )
                          }
                        >
                          {t("actions.makeMember")}
                        </DropdownMenuItem>
                        {showSeatManagement ? (
                          member.seatAssignedAt ? (
                            <DropdownMenuItem
                              onClick={() =>
                                runMemberAction(
                                  () =>
                                    unassignAdminOrganizationMemberSeatAction({
                                      slug: detail.organization.slug,
                                      memberId: member.id,
                                    }),
                                  t("seatUnassignSuccess"),
                                )
                              }
                            >
                              {t("actions.unassignSeat")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                runMemberAction(
                                  () =>
                                    assignAdminOrganizationMemberSeatAction({
                                      slug: detail.organization.slug,
                                      memberId: member.id,
                                    }),
                                  t("seatAssignSuccess"),
                                )
                              }
                            >
                              {t("actions.assignSeat")}
                            </DropdownMenuItem>
                          )
                        ) : null}
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            runMemberAction(
                              () =>
                                removeAdminOrganizationMemberAction({
                                  slug: detail.organization.slug,
                                  memberId: member.id,
                                }),
                              t("removeSuccess"),
                            )
                          }
                        >
                          {t("actions.remove")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
