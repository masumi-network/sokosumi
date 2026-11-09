"use client";

import type { DataRoomMember, DataRoomTreeRow } from "@sokosumi/core-client";
import { UserPlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  dataRoomRefusal,
  inviteToDataRoom,
  removeDataRoomMember,
} from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import { DataRoomDateField } from "./data-room-date-field";

/** Splits pasted addresses on commas, semicolons, spaces and new lines. */
export function parseEmails(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function DataRoomPeople({
  store,
  roomId,
  members,
  rows,
  onChanged,
}: {
  store: FileStore;
  roomId: string;
  members: DataRoomMember[];
  rows: DataRoomTreeRow[];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Drive.DataRoom.People");
  const format = useFormatter();
  const emailsId = useId();
  const expiresId = useId();
  const [emails, setEmails] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<DataRoomMember | null>(null);
  const topFolders = rows.filter(
    (row) => row.kind === "folder" && row.depth === 0,
  );
  const parsed = parseEmails(emails);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (parsed.length === 0) return;
    setBusy(true);
    try {
      await inviteToDataRoom({
        store,
        roomId,
        emails: parsed,
        expiresAt,
        folderPaths: folders,
      });
      toast.success(t("invited", { count: parsed.length }));
      setEmails("");
      setExpiresAt(null);
      setFolders([]);
      onChanged();
    } catch (error) {
      toast.error(dataRoomRefusal(error) ?? t("inviteFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(member: DataRoomMember) {
    setBusy(true);
    try {
      await removeDataRoomMember({ store, roomId, memberId: member.id });
      toast.success(t("removed", { email: member.email }));
      onChanged();
    } catch (error) {
      toast.error(dataRoomRefusal(error) ?? t("removeFailed"));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  function status(member: DataRoomMember): string {
    if (member.revokedAt) return t("statusRemoved");
    if (member.expiresAt && new Date(member.expiresAt) <= new Date())
      return t("statusExpired");
    if (member.lastVisitAt)
      return t("statusVisited", {
        when: format.relativeTime(new Date(member.lastVisitAt)),
      });
    return member.invited ? t("statusInvited") : t("statusDomain");
  }

  return (
    <div className="grid gap-2">
      <form
        className={cn(HOLDER_ITEM_CLASS, "grid gap-3 p-4")}
        onSubmit={handleInvite}
      >
        <Label htmlFor={emailsId}>{t("emailsLabel")}</Label>
        <Textarea
          id={emailsId}
          rows={2}
          placeholder="anna@fund.com, ben@fund.com"
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={expiresId}>{t("expiresLabel")}</Label>
            <DataRoomDateField
              id={expiresId}
              value={expiresAt}
              placeholder={t("noEnd")}
              clearLabel={t("clearEnd")}
              onChange={setExpiresAt}
            />
          </div>
          {topFolders.length > 0 ? (
            <fieldset className="grid gap-1.5">
              <legend className="text-sm font-medium">
                {t("foldersLabel")}
              </legend>
              <p className="text-muted-foreground text-xs">
                {t("foldersHint")}
              </p>
              {topFolders.map((folder) => (
                <Label
                  key={folder.path}
                  className="flex items-center gap-2 font-normal"
                >
                  <Checkbox
                    checked={folders.includes(folder.path)}
                    onCheckedChange={(checked) =>
                      setFolders((current) =>
                        checked
                          ? [...current, folder.path]
                          : current.filter((path) => path !== folder.path),
                      )
                    }
                  />
                  {folder.number} {folder.name}
                </Label>
              ))}
            </fieldset>
          ) : null}
        </div>
        <Button
          type="submit"
          className="justify-self-start"
          loading={busy}
          disabled={parsed.length === 0}
        >
          <UserPlus aria-hidden className="size-4" />
          {parsed.length > 1
            ? t("inviteMany", { count: parsed.length })
            : t("invite")}
        </Button>
      </form>

      {members.length === 0 ? (
        <p
          className={cn(HOLDER_ITEM_CLASS, "text-muted-foreground p-4 text-sm")}
        >
          {t("empty")}
        </p>
      ) : (
        <ul className={cn(HOLDER_ITEM_CLASS, "divide-border divide-y")}>
          {members.map((member) => (
            <li
              key={member.id}
              className={cn(
                "flex min-w-0 flex-wrap items-center gap-3 px-4 py-3",
                member.revokedAt && "text-muted-foreground",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.name
                    ? `${member.name} · ${member.email}`
                    : member.email}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {status(member)}
                  {member.folderPaths.length > 0
                    ? ` · ${t("onlyFolders", { folders: member.folderPaths.join(", ") })}`
                    : ""}
                  {member.expiresAt && !member.revokedAt
                    ? ` · ${t("until", {
                        date: format.dateTime(new Date(member.expiresAt), {
                          dateStyle: "medium",
                        }),
                      })}`
                    : ""}
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {t("counts", {
                  views: member.views,
                  downloads: member.downloads,
                })}
              </span>
              {member.revokedAt ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRemoving(member)}
                >
                  {t("remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("removeTitle", { email: removing?.email ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              loading={busy}
              onClick={(event) => {
                event.preventDefault();
                if (removing) void handleRemove(removing);
              }}
            >
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
