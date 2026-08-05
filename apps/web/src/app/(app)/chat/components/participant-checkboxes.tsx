"use client";

import { Bot, Search, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Coworker, Member } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { AiCoworkerIcon, MembersRosterLoadFailed } from "./room-draft-shared";
import { toggleId } from "./room-helpers";

export interface ParticipantCheckboxesProps {
  members: Member[];
  coworkers: Coworker[];
  memberIds: string[];
  coworkerIds: string[];
  onMemberIdsChange: (ids: string[]) => void;
  onCoworkerIdsChange: (ids: string[]) => void;
  membersLoadFailed: boolean;
}

export function ParticipantCheckboxes({
  members,
  coworkers,
  memberIds,
  coworkerIds,
  onMemberIdsChange,
  onCoworkerIdsChange,
  membersLoadFailed,
}: ParticipantCheckboxesProps) {
  const t = useTranslations("App.Channels");
  const [participantQuery, setParticipantQuery] = useState("");
  const normalizedQuery = participantQuery.trim().toLowerCase();
  const selectedCount = memberIds.length + coworkerIds.length;
  const filteredMembers = useMemo(() => {
    if (!normalizedQuery) {
      return members;
    }

    return members.filter((member) =>
      [member.user.name, member.user.email]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [members, normalizedQuery]);
  const filteredCoworkers = useMemo(() => {
    if (!normalizedQuery) {
      return coworkers;
    }

    return coworkers.filter((coworker) =>
      [coworker.name, coworker.slug, coworker.caption]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [coworkers, normalizedQuery]);

  return (
    <div className="rounded-lg border bg-background">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{t("Dialog.participants")}</p>
            <p className="text-muted-foreground text-xs">
              {selectedCount > 0
                ? t("Dialog.selectedParticipants", { count: selectedCount })
                : t("Dialog.createDescription")}
            </p>
          </div>
          <Users className="text-muted-foreground size-4 shrink-0" />
        </div>
        <div className="relative mt-3">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={participantQuery}
            onChange={(event) => setParticipantQuery(event.target.value)}
            placeholder={t("Draft.searchPlaceholder")}
            className="h-9 rounded-full border-0 bg-muted/60 pr-4 pl-9 shadow-none focus-visible:ring-1"
          />
        </div>
      </div>

      <ScrollArea className="h-[300px]">
        <div className="p-2">
          {membersLoadFailed ? (
            <div className="pb-2">
              <MembersRosterLoadFailed className="px-3 py-6" />
            </div>
          ) : filteredMembers.length > 0 ? (
            <div className="pb-2">
              <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium">
                {t("Dialog.humans")}
              </div>
              <div className="space-y-0.5">
                {filteredMembers.map((member) => {
                  const checked = memberIds.includes(member.user.id);
                  const displayName = member.user.name || member.user.email;

                  return (
                    <label
                      key={member.user.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors",
                        checked ? "bg-muted/70" : "hover:bg-muted/50",
                      )}
                    >
                      <Avatar className="size-8">
                        <AvatarImage
                          src={member.user.image ?? undefined}
                          alt=""
                        />
                        <AvatarFallback className="text-xs">
                          {getInitials(displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {displayName}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {member.user.email}
                        </span>
                      </span>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          onMemberIdsChange(
                            toggleId(
                              memberIds,
                              member.user.id,
                              nextChecked === true,
                            ),
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {filteredCoworkers.length > 0 ? (
            <div className="pt-1">
              <div className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium">
                <Bot className="size-3" aria-hidden />
                {t("Dialog.coworkers")}
              </div>
              <div className="space-y-0.5">
                {filteredCoworkers.map((coworker) => {
                  const checked = coworkerIds.includes(coworker.id);

                  return (
                    <label
                      key={coworker.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors",
                        checked ? "bg-muted/70" : "hover:bg-muted/50",
                      )}
                    >
                      <Avatar className="size-8">
                        <AvatarImage src={coworker.image ?? undefined} alt="" />
                        <AvatarFallback className="text-xs">
                          {getInitials(coworker.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {coworker.name}
                          </span>
                          <AiCoworkerIcon />
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          @{coworker.slug}
                        </span>
                      </span>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          onCoworkerIdsChange(
                            toggleId(
                              coworkerIds,
                              coworker.id,
                              nextChecked === true,
                            ),
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!membersLoadFailed &&
          filteredMembers.length === 0 &&
          filteredCoworkers.length === 0 ? (
            <div className="text-muted-foreground px-4 py-12 text-center text-sm">
              {t("Draft.noResults")}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
