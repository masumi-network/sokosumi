"use client";

import {
  type DataRoomColleague,
  type Member,
  MemberRole,
} from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  dataRoomRefusal,
  fetchOrganizationMembers,
  saveDataRoomColleagues,
} from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";

/** Who in the organization is always in, whatever is ticked. */
export function alwaysIn(member: Member, makerId: string): boolean {
  return (
    member.user.id === makerId ||
    member.role === MemberRole.OWNER ||
    member.role === MemberRole.ADMIN
  );
}

/**
 * Who inside the organization may see an organization room: its maker, the
 * owners and admins, and the colleagues chosen here. Everyone else never
 * sees the folder in Files.
 */
export function DataRoomColleagues({
  store,
  organizationId,
  roomId,
  makerId,
  colleagues,
  canChoose,
  onChanged,
}: {
  store: FileStore;
  organizationId: string;
  roomId: string;
  makerId: string;
  colleagues: DataRoomColleague[];
  canChoose: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("App.Drive.DataRoom.Colleagues");
  const saved = colleagues.map((colleague) => colleague.userId);
  const [chosen, setChosen] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  const members = useQuery({
    queryKey: ["organization", organizationId, "members"],
    queryFn: () => fetchOrganizationMembers(organizationId),
    enabled: canChoose,
  });
  const changed =
    chosen.length !== saved.length ||
    chosen.some((userId) => !saved.includes(userId));

  async function handleSave() {
    setBusy(true);
    try {
      await saveDataRoomColleagues({ store, roomId, userIds: chosen });
      toast.success(t("saved"));
      onChanged();
    } catch (error) {
      toast.error(dataRoomRefusal(error) ?? t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`${roomId}-colleagues`}
      className={cn(HOLDER_ITEM_CLASS, "grid gap-3 p-4")}
    >
      <div className="grid gap-1">
        <h2 id={`${roomId}-colleagues`} className="text-sm font-medium">
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-sm">{t("hint")}</p>
      </div>

      {!canChoose ? (
        <p className="text-sm">
          {colleagues.length === 0
            ? t("nobodyElse")
            : colleagues.map((colleague) => colleague.name).join(", ")}
        </p>
      ) : members.isError ? (
        <p className="text-muted-foreground text-sm" role="alert">
          {t("loadFailed")}
        </p>
      ) : !members.data ? (
        <div className="grid gap-2" role="status">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-1/3" />
        </div>
      ) : (
        <>
          <ul className="grid gap-2">
            {members.data.map((member) => {
              const always = alwaysIn(member, makerId);
              return (
                <li key={member.id}>
                  <Label className="flex min-w-0 items-center gap-2 font-normal">
                    <Checkbox
                      checked={always || chosen.includes(member.user.id)}
                      disabled={always || busy}
                      onCheckedChange={(checked) =>
                        setChosen((current) =>
                          checked
                            ? [...current, member.user.id]
                            : current.filter((id) => id !== member.user.id),
                        )
                      }
                    />
                    <span className="min-w-0 truncate">
                      {member.user.name}
                      <span className="text-muted-foreground">
                        {" · "}
                        {member.user.email}
                      </span>
                    </span>
                    {always ? (
                      <span className="text-muted-foreground ms-auto shrink-0 text-xs">
                        {member.user.id === makerId ? t("madeIt") : t("admin")}
                      </span>
                    ) : null}
                  </Label>
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            className="justify-self-start"
            loading={busy}
            disabled={!changed}
            onClick={() => void handleSave()}
          >
            {t("save")}
          </Button>
        </>
      )}
    </section>
  );
}
