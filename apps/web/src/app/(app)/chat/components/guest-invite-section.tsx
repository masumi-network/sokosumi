"use client";

import { Copy, Link2, Loader2, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import {
  createRoomGuestInviteLinkAction,
  createRoomInvitationAction,
  listRoomGuestInviteLinksAction,
  listRoomInvitationsAction,
  removeRoomGuestAction,
  revokeRoomGuestInviteLinkAction,
  revokeRoomInvitationAction,
} from "@/app/chat/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ChatRoomGuestInviteLink,
  ChatRoomInvitation,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { isValidEmail } from "@/lib/utils/email";

interface GuestInviteSectionProps {
  roomId: string;
  /** Current guest participants (from room DTO). */
  guests: ChatRoomUserParticipant[];
  /** Called after a guest is removed so the parent can refresh room state. */
  onGuestRemoved?: (userId: string) => void;
}

/**
 * Guest invite UI for external channels.
 *
 * Parent mounts this only while the edit dialog is open (and keys by room id)
 * so reopen remounts and refetches pending invites — no open-synced useEffect.
 */
export function GuestInviteSection({
  roomId,
  guests,
  onGuestRemoved,
}: GuestInviteSectionProps) {
  const t = useTranslations("App.Channels.GuestInvite");
  const [email, setEmail] = useState("");
  const [invitations, setInvitations] = useState<ChatRoomInvitation[]>([]);
  const [inviteLinks, setInviteLinks] = useState<ChatRoomGuestInviteLink[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  const loadInvitations = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    const [invitationsResult, linksResult] = await Promise.all([
      listRoomInvitationsAction(roomId),
      listRoomGuestInviteLinksAction(roomId),
    ]);
    setIsLoading(false);
    if (!invitationsResult.ok || !linksResult.ok) {
      setLoadFailed(true);
      setInvitations([]);
      setInviteLinks([]);
      return;
    }
    setInvitations(
      invitationsResult.value.filter((inv) => inv.status === "pending"),
    );
    // Show non-revoked links (expired/depleted still useful for audit until host revokes).
    setInviteLinks(linksResult.value.filter((link) => !link.revokedAt));
  }, [roomId]);

  // Mount-only fetch; parent remounts on dialog open so reopen is fresh.
  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !isValidEmail(trimmed)) {
      toast.error(t("invalidEmail"));
      return;
    }

    startTransition(async () => {
      const result = await createRoomInvitationAction(roomId, trimmed);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(t("inviteSuccess", { email: result.value.email }));
      setEmail("");
      setInvitations((prev) => {
        if (prev.some((inv) => inv.id === result.value.id)) {
          return prev;
        }
        return [result.value, ...prev];
      });
    });
  }

  async function handleRevoke(invitationId: string) {
    if (revokingId) return;
    setRevokingId(invitationId);
    const result = await revokeRoomInvitationAction(roomId, invitationId);
    setRevokingId(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(t("revokeSuccess"));
    setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
  }

  async function handleCreateLink() {
    if (isCreatingLink) return;
    setIsCreatingLink(true);
    const result = await createRoomGuestInviteLinkAction(roomId);
    setIsCreatingLink(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setInviteLinks((prev) => [result.value, ...prev]);
    try {
      await navigator.clipboard.writeText(result.value.url);
      toast.success(t("linkCreateCopySuccess"));
    } catch {
      toast.success(t("linkCreateSuccess"));
    }
  }

  async function handleCopyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("linkCopySuccess"));
    } catch {
      toast.error(t("linkCopyError"));
    }
  }

  async function handleRevokeLink(token: string) {
    if (revokingToken) return;
    setRevokingToken(token);
    const result = await revokeRoomGuestInviteLinkAction(roomId, token);
    setRevokingToken(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(t("linkRevokeSuccess"));
    setInviteLinks((prev) => prev.filter((link) => link.token !== token));
  }

  async function handleRemoveGuest(userId: string, label: string) {
    if (removingUserId) return;
    setRemovingUserId(userId);
    const result = await removeRoomGuestAction(roomId, userId);
    setRemovingUserId(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(t("removeGuestSuccess", { name: label }));
    onGuestRemoved?.(userId);
  }

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden border-t pt-4">
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <UserPlus className="size-4 shrink-0" aria-hidden />
          {t("title")}
        </p>
        <p className="text-muted-foreground text-xs">{t("description")}</p>
      </div>

      {/* Email invite — direct, known recipient */}
      <div className="bg-muted/20 min-w-0 space-y-3 overflow-hidden rounded-lg border p-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{t("emailTitle")}</p>
          <p className="text-muted-foreground text-xs">
            {t("emailDescription")}
          </p>
        </div>

        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={handleSubmit}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="guest-invite-email">{t("emailLabel")}</Label>
            <Input
              id="guest-invite-email"
              type="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isPending}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={isPending || !email.trim()}
            className="sm:mb-0"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {t("send")}
          </Button>
        </form>

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t("pendingTitle")}
          </p>
          {isLoading ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("loading")}
            </p>
          ) : loadFailed ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="text-muted-foreground text-sm">{t("loadError")}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void loadInvitations()}
              >
                {t("retry")}
              </Button>
            </div>
          ) : invitations.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="bg-muted/40 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{invitation.email}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={t("revokeAria", { email: invitation.email })}
                    title={t("revoke")}
                    disabled={revokingId === invitation.id}
                    onClick={() => void handleRevoke(invitation.id)}
                  >
                    {revokingId === invitation.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-4" aria-hidden />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Shareable link — multi-use, no email required */}
      <div className="bg-muted/20 min-w-0 space-y-3 overflow-hidden rounded-lg border p-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="size-4 shrink-0" aria-hidden />
              {t("linksTitle")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("linksDescription")}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            disabled={isCreatingLink}
            onClick={() => void handleCreateLink()}
          >
            {isCreatingLink ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Link2 className="size-4" aria-hidden />
            )}
            {t("createLink")}
          </Button>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("loading")}
          </p>
        ) : inviteLinks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("linksEmpty")}</p>
        ) : (
          <ul className="min-w-0 space-y-1.5">
            {inviteLinks.map((link) => (
              <li
                key={link.token}
                className="bg-muted/40 flex min-w-0 items-center gap-2 overflow-hidden rounded-md px-3 py-2 text-sm"
              >
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs"
                  title={link.url}
                >
                  {link.url}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("copyLinkAria")}
                    title={t("copyLink")}
                    onClick={() => void handleCopyLink(link.url)}
                  >
                    <Copy className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("revokeLinkAria")}
                    title={t("revokeLink")}
                    disabled={revokingToken === link.token}
                    onClick={() => void handleRevokeLink(link.token)}
                  >
                    {revokingToken === link.token ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("guestsTitle")}
        </p>
        {guests.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("guestsEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {guests.map((guest) => {
              const label = guest.name?.trim() || guest.email;
              return (
                <li
                  key={guest.id}
                  className="bg-muted/40 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {label}
                    {guest.name?.trim() ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({guest.email})
                      </span>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={t("removeGuestAria", { name: label })}
                    title={t("removeGuest")}
                    disabled={removingUserId === guest.id}
                    onClick={() => void handleRemoveGuest(guest.id, label)}
                  >
                    {removingUserId === guest.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-4" aria-hidden />
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
