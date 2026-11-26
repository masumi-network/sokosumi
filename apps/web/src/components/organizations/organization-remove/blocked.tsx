"use client";

import type {
  OrganizationDeletionEvaluation,
  OrganizationRecord,
} from "@sokosumi/core-client";
import {
  Building2,
  Clock,
  CreditCard,
  type LucideIcon,
  SquareCheck,
  UserMinus,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Blocker = OrganizationDeletionEvaluation["blockers"][number];

const ROWS: Record<
  Blocker,
  {
    icon: LucideIcon;
    message: string;
    href?: string;
    link?: "members" | "billing" | "jobs" | "tasks";
  }
> = {
  ORGANIZATION_HAS_ADDITIONAL_MEMBERS: {
    icon: UserMinus,
    message: "additionalMembers",
    href: "#members",
    link: "members",
  },
  RUNNING_SUBSCRIPTION: {
    icon: CreditCard,
    message: "runningSubscription",
    href: "/billing",
    link: "billing",
  },
  ENTERPRISE_CONTRACT_ACTIVE: {
    icon: CreditCard,
    message: "enterpriseContractActive",
    href: "/billing",
    link: "billing",
  },
  LAST_WORKSPACE: { icon: Building2, message: "lastWorkspace" },
  IN_FLIGHT_JOB: {
    icon: Clock,
    message: "inFlightJob",
    // Bare /history shows only your own jobs; the blocker counts everyone's.
    href: "/history?scope=workspace",
    link: "jobs",
  },
  UNSETTLED_ON_CHAIN_JOB: {
    icon: Clock,
    message: "unsettledOnChainJob",
    href: "/history?scope=workspace",
    link: "jobs",
  },
  IN_FLIGHT_TASK: {
    icon: SquareCheck,
    message: "inFlightTask",
    href: "/tasks",
    link: "tasks",
  },
};

interface OrganizationRemoveBlockedProps {
  organization: OrganizationRecord;
  blockers: OrganizationDeletionEvaluation["blockers"];
  otherMemberCount: number;
  /** Jobs and Tasks show the active workspace only, so link them only then. */
  isActiveOrganization: boolean;
  onGoToMembers: () => void;
}

/** Deletion can't happen yet: say why, link each fix, and offer only Close. */
export function OrganizationRemoveBlocked({
  organization,
  blockers,
  otherMemberCount,
  isActiveOrganization,
  onGoToMembers,
}: OrganizationRemoveBlockedProps) {
  const t = useTranslations("Components.Organizations.RemoveModal.Blocked");

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-lg font-medium text-pretty">
          {t("title", { organization: organization.name })}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-muted-foreground">
          {t("description")}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ul className="flex flex-col gap-2">
        {blockers.map((code) => {
          const { icon: Icon, message, href, link } = ROWS[code];
          const workspaceOnly = link === "jobs" || link === "tasks";
          return (
            <li
              key={code}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-sm"
            >
              <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                {t(message, { count: otherMemberCount })}
              </span>
              {workspaceOnly && !isActiveOrganization ? (
                <span className="text-muted-foreground basis-full ps-11 text-xs">
                  {t("switchWorkspace")}
                </span>
              ) : href && link ? (
                <Link
                  href={
                    link === "billing"
                      ? `${href}?organizationId=${organization.id}`
                      : href
                  }
                  className="inline-flex min-h-6 items-center font-medium underline underline-offset-4"
                  onClick={(event) => {
                    if (link !== "members") return;
                    event.preventDefault();
                    onGoToMembers();
                  }}
                >
                  {t(`Links.${link}`)}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      <AlertDialogFooter>
        <AlertDialogCancel>{t("close")}</AlertDialogCancel>
      </AlertDialogFooter>
    </>
  );
}
