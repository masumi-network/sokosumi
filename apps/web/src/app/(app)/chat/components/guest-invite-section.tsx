"use client";

import { Loader2, Trash2, UserPlus } from "lucide-react";
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
  createRoomInvitationAction,
  listRoomInvitationsAction,
  removeRoomGuestAction,
  revokeRoomInvitationAction,
} from "@/app/chat/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ChatRoomInvitation,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { isValidEmail } from "@/lib/utils/email";

interface GuestInviteSectionProps {
  roomId: string;
  /** When false, section is not rendered (guests / non-external). */
  enabled: boolean;
  /** Reload pending list when the parent dialog opens. */
  open: boolean;
  /** Current guest participants (from room DTO). */
  guests: ChatRoomUserParticipant[];
  /** Called after a guest is removed so the parent can refresh room state. */
  onGuestRemoved?: (userId: string) => void;
}

export function GuestInviteSection({
  roomId,
  enabled,
  open,
  guests,
  onGuestRemoved,
}: GuestInviteSectionProps) {
  const t = useTranslations("App.Channels.GuestInvite");
  const [email, setEmail] = useState("");
  const [invitations, setInvitations] = useState<ChatRoomInvitation[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  const loadInvitations = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    const result = await listRoomInvitationsAction(roomId);
    setIsLoading(false);
    if (!result.ok) {
      setLoadFailed(true);
      setInvitations([]);
      return;
    }
    setInvitations(result.value.filter((inv) => inv.status === "pending"));
  }, [roomId]);

  useEffect(() => {
    if (!enabled || !open) return;
    void loadInvitations();
  }, [enabled, open, loadInvitations]);

  useEffect(() => {
    if (!open) {
      setEmail("");
    }
  }, [open]);

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

  if (!enabled) {
    return null;
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <UserPlus className="size-4" aria-hidden />
          {t("title")}
        </p>
        <p className="text-muted-foreground text-xs">{t("description")}</p>
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
  );
}
