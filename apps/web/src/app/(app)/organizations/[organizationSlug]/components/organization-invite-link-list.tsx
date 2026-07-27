"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { revokeOrganizationInviteLink } from "@/lib/actions/organization/invite-link-action";
import type { OrganizationInviteLink } from "@/lib/clients/generated/core";
import {
  canRevokeInviteLink,
  evaluateInviteLinkDisplayStatus,
  type InviteLinkDisplayStatus,
} from "@/lib/utils/organization-invite-link";

const COPIED_RESET_MS = 2000;

interface OrganizationInviteLinkListProps {
  organizationId: string;
  inviteLinks: OrganizationInviteLink[];
}

function statusBadgeVariant(status: InviteLinkDisplayStatus) {
  switch (status) {
    case "valid":
      return "default" as const;
    case "depleted":
      return "secondary" as const;
    case "expired":
      return "outline" as const;
    case "revoked":
      return "destructive" as const;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function statusLabelKey(status: InviteLinkDisplayStatus) {
  switch (status) {
    case "valid":
      return "statusActive";
    case "depleted":
      return "statusDepleted";
    case "expired":
      return "statusExpired";
    case "revoked":
      return "statusRevoked";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function OrganizationInviteLinkList({
  organizationId,
  inviteLinks,
}: OrganizationInviteLinkListProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail.InviteLinks");
  const formatter = useFormatter();
  const router = useRouter();

  if (inviteLinks.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("listEmpty")}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("columnStatus")}</TableHead>
          <TableHead>{t("columnUses")}</TableHead>
          <TableHead>{t("columnExpires")}</TableHead>
          <TableHead>{t("columnCreated")}</TableHead>
          <TableHead className="text-right">{t("columnActions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {inviteLinks.map((link) => (
          <InviteLinkRow
            key={link.token}
            link={link}
            organizationId={organizationId}
            formatter={formatter}
            t={t}
            onRevoked={() => router.refresh()}
          />
        ))}
      </TableBody>
    </Table>
  );
}

interface InviteLinkRowProps {
  link: OrganizationInviteLink;
  organizationId: string;
  formatter: ReturnType<typeof useFormatter>;
  t: ReturnType<typeof useTranslations>;
  onRevoked: () => void;
}

function InviteLinkRow({
  link,
  organizationId,
  formatter,
  t,
  onRevoked,
}: InviteLinkRowProps) {
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const status = evaluateInviteLinkDisplayStatus(link);
  const statusLabel = t(statusLabelKey(status));

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error(t("copyError"));
    }
  }, [link.url, t]);

  async function handleConfirmRevoke() {
    setRevoking(true);
    try {
      const result = await revokeOrganizationInviteLink({
        organizationId,
        token: link.token,
      });

      if (!result.ok) {
        toast.error(result.error?.message ?? t("revokeError"));
        return;
      }

      toast.success(t("revokeSuccess"));
      setConfirmOpen(false);
      onRevoked();
    } catch {
      toast.error(t("revokeError"));
    } finally {
      setRevoking(false);
    }
  }

  const usesLabel =
    link.maxUses === null
      ? t("usesUnlimited", { useCount: link.useCount })
      : t("usesLimited", { useCount: link.useCount, maxUses: link.maxUses });

  return (
    <TableRow>
      <TableCell>
        <Badge variant={statusBadgeVariant(status)}>{statusLabel}</Badge>
      </TableCell>
      <TableCell className="tabular-nums">{usesLabel}</TableCell>
      <TableCell>
        {formatter.dateTime(link.expiresAt, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </TableCell>
      <TableCell>
        {formatter.dateTime(link.createdAt, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            <span className="sr-only">{t("copy")}</span>
          </Button>
          {canRevokeInviteLink(link) ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                disabled={revoking}
                onClick={() => setConfirmOpen(true)}
              >
                {t("revoke")}
              </Button>
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("revokeDialog.title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("revokeDialog.description")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={revoking}>
                      {t("revokeDialog.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={revoking}
                      className={buttonVariants({ variant: "destructive" })}
                      onClick={(event) => {
                        event.preventDefault();
                        void handleConfirmRevoke();
                      }}
                    >
                      {revoking ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      {t("revokeDialog.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
