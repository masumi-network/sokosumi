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
    href: "/history",
    link: "jobs",
  },
  UNSETTLED_ON_CHAIN_JOB: {
    icon: Clock,
    message: "unsettledOnChainJob",
    href: "/history",
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
  onGoToMembers: () => void;
}

/** Deletion can't happen yet: say why, link each fix, and offer only Close. */
export function OrganizationRemoveBlocked({
  organization,
  blockers,
  otherMemberCount,
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
              {href && link ? (
                <Link
                  href={href}
                  className="font-medium underline underline-offset-4"
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
