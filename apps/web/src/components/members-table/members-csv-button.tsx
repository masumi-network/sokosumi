"use client";

import type { PendingInvitation } from "@sokosumi/core-client";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { membersCsv } from "./members-csv";
import type { OrganizationMember } from "./types";

/** A byte order mark, so a spreadsheet opens the file as UTF-8 and keeps umlauts and accents. */
const UTF8_BOM = "﻿";

interface MembersCsvButtonProps {
  organizationSlug: string;
  members: OrganizationMember[];
  pendingInvitations: PendingInvitation[];
  className?: string | undefined;
}

/** Saves every member and invitation as "members-<organization>-<today>.csv". */
export function MembersCsvButton({
  organizationSlug,
  members,
  pendingInvitations,
  className,
}: MembersCsvButtonProps) {
  const t = useTranslations("Components.MembersTable.Export");
  const tRole = useTranslations("Components.Organizations.Role");

  function handleDownload() {
    const csv = membersCsv(members, pendingInvitations, {
      headers: [
        t("name"),
        t("email"),
        t("role"),
        t("status"),
        t("joined"),
        t("lastSeen"),
        t("invited"),
        t("expires"),
      ],
      active: t("active"),
      pending: tRole("pending"),
      expired: tRole("expired"),
      role: (role) => (tRole.has(role) ? tRole(role) : role),
    });
    const url = URL.createObjectURL(
      new Blob([UTF8_BOM, csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `members-${organizationSlug}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    // After the click has started the download.
    setTimeout(() => URL.revokeObjectURL(url));
  }

  return (
    <Button variant="outline" onClick={handleDownload} className={className}>
      <Download aria-hidden className="size-3.5" />
      {t("button")}
    </Button>
  );
}
