"use client";

import { Bot, Loader2, Search, Settings2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { updateChannelAction } from "@/app/chat/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { ChatRoom, Coworker, Member } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { AiCoworkerIcon } from "./channel-draft-shared";
import { toggleId } from "./channel-helpers";

function ParticipantCheckboxes({
  members,
  coworkers,
  memberIds,
  coworkerIds,
  onMemberIdsChange,
  onCoworkerIdsChange,
}: {
  members: Member[];
  coworkers: Coworker[];
  memberIds: string[];
  coworkerIds: string[];
  onMemberIdsChange: (ids: string[]) => void;
  onCoworkerIdsChange: (ids: string[]) => void;
}) {
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
          {filteredMembers.length > 0 ? (
            <div className="pb-2">
              <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-medium">
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
              <div className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[11px] font-medium">
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

          {filteredMembers.length === 0 && filteredCoworkers.length === 0 ? (
            <div className="text-muted-foreground px-4 py-12 text-center text-sm">
              {t("Draft.noResults")}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

export function EditChannelDialog({
  channel,
  members,
  coworkers,
}: {
  channel: ChatRoom;
  members: Member[];
  coworkers: Coworker[];
}) {
  const t = useTranslations("App.Channels");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(
    channel.userMembers.map((member) => member.id),
  );
  const [coworkerIds, setCoworkerIds] = useState<string[]>(
    channel.coworkerMembers.map((coworker) => coworker.id),
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(channel.name);
    setTopic(channel.topic ?? "");
    setMemberIds(channel.userMembers.map((member) => member.id));
    setCoworkerIds(channel.coworkerMembers.map((coworker) => coworker.id));
  }, [channel, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateChannelAction(channel.id, {
        name,
        topic,
        memberUserIds: memberIds,
        coworkerIds,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          aria-label={t("editChannel")}
          title={t("editChannel")}
        >
          <Settings2 className="size-4" aria-hidden />
        </Button>
      </DialogTrigger>
      {/* The fixed-height participant list makes this dialog ~755px tall, which
          overflows a shorter phone — on a 667px iPhone SE the title and close
          button were cut off above the viewport and Cancel below it, with
          nothing to scroll. Cap it to the viewport and scroll the body. */}
      {/* The fixed-height participant list makes this dialog ~755px tall, which
          overflows a shorter phone — on a 667px iPhone SE the title and close
          button sat above the viewport and Cancel below it, with nothing to
          scroll. Cap the dialog to the viewport and scroll the form body rather
          than the padded dialog box, whose children do not reflow around their
          own scrollbar. */}
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto shadow-none sm:max-w-2xl">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("Dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("Dialog.editDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-channel-name">{t("Dialog.name")}</Label>
              <Input
                id="edit-channel-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-channel-topic">{t("Dialog.topic")}</Label>
              <Textarea
                id="edit-channel-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                rows={3}
              />
            </div>
            <ParticipantCheckboxes
              members={members}
              coworkers={coworkers}
              memberIds={memberIds}
              coworkerIds={coworkerIds}
              onMemberIdsChange={setMemberIds}
              onCoworkerIdsChange={setCoworkerIds}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t("Dialog.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("Dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
