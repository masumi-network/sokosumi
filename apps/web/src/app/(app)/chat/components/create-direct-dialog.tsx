"use client";

import { Loader2, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type ChatComposeRoster,
  createDirectRoomAction,
  ensureCoworkerDirectRoomAction,
  loadChatComposeRosterAction,
} from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { getInitials } from "@/lib/utils/text";
import {
  CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME,
  EMPTY_CHAT_COMPOSE_ROSTER,
} from "./chat-compose-dialog";
import {
  AiCoworkerIcon,
  buildDirectDraftTargets,
  type DirectDraftTarget,
  DirectDraftTargetList,
  filterDraftTargets,
  MembersRosterLoadFailed,
} from "./room-draft-shared";

export function CreateDirectDialog() {
  const t = useTranslations("App.Channels");
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<ChatComposeRoster>(
    EMPTY_CHAT_COMPOSE_ROSTER,
  );
  const [recipientQuery, setRecipientQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [, startRosterTransition] = useTransition();
  const rosterLoadGenerationRef = useRef(0);

  const targets = useMemo(
    () =>
      buildDirectDraftTargets(
        roster.members,
        roster.coworkers,
        roster.currentUserId,
      ),
    [roster.coworkers, roster.currentUserId, roster.members],
  );
  const selectedTargets = useMemo(() => {
    const byKey = new Map(targets.map((target) => [target.key, target]));
    return selectedKeys
      .map((key) => byKey.get(key))
      .filter((target): target is DirectDraftTarget => Boolean(target));
  }, [selectedKeys, targets]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const candidateTargets = useMemo(
    () => filterDraftTargets(targets, selectedKeySet, recipientQuery),
    [recipientQuery, selectedKeySet, targets],
  );
  const selectedMemberUserIds = selectedTargets
    .filter((target) => target.kind === "human")
    .map((target) => target.id);
  const selectedCoworkerIds = selectedTargets
    .filter((target) => target.kind === "coworker")
    .map((target) => target.id);
  const hasSelectedHumans = selectedMemberUserIds.length > 0;
  const hasSelectedCoworker = selectedCoworkerIds.length > 0;
  const crossKindDisabledReason = hasSelectedHumans
    ? t("Draft.groupDirectHumansOnly")
    : hasSelectedCoworker
      ? t("Draft.coworkerDirectOneToOneOnly")
      : undefined;

  function isTargetDisabled(target: DirectDraftTarget): boolean {
    if (hasSelectedHumans && target.kind === "coworker") {
      return true;
    }
    if (hasSelectedCoworker && target.kind === "human") {
      return true;
    }
    if (
      target.kind === "human" &&
      hasSelectedHumans &&
      !roster.hasOrganization
    ) {
      return true;
    }
    return false;
  }

  function addTarget(target: DirectDraftTarget) {
    if (isTargetDisabled(target)) {
      return;
    }
    if (target.kind === "coworker") {
      setSelectedKeys([target.key]);
    } else {
      setSelectedKeys((current) =>
        current.includes(target.key) ? current : [...current, target.key],
      );
    }
    setRecipientQuery("");
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeTarget(key: string) {
    setSelectedKeys((current) => current.filter((item) => item !== key));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function resetDialog() {
    setRoster(EMPTY_CHAT_COMPOSE_ROSTER);
    setRecipientQuery("");
    setSelectedKeys([]);
    setRosterLoaded(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (isPending) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      rosterLoadGenerationRef.current += 1;
      resetDialog();
      return;
    }
    const generation = rosterLoadGenerationRef.current + 1;
    rosterLoadGenerationRef.current = generation;
    startRosterTransition(async () => {
      const result = await loadChatComposeRosterAction();
      if (generation !== rosterLoadGenerationRef.current) {
        return;
      }
      if (!result.ok) {
        toast.error(result.error.message);
        setRosterLoaded(true);
        return;
      }
      setRoster(result.value);
      setRosterLoaded(true);
    });
  }

  function handleCreate() {
    if (isPending || selectedTargets.length === 0) {
      return;
    }
    startTransition(async () => {
      const result =
        selectedCoworkerIds.length === 1
          ? await ensureCoworkerDirectRoomAction(selectedCoworkerIds[0])
          : await createDirectRoomAction({
              memberUserIds: selectedMemberUserIds,
            });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Draft.chooseRecipientError"));
        return;
      }
      if (!result.value) {
        toast.error(t("Draft.chooseRecipientError"));
        return;
      }
      notifyOrganizationChatRoomsChanged(result.value);
      setOpen(false);
      resetDialog();
      router.push(`/chat/rooms/${result.value.id}`);
    });
  }

  const extraHumanDisabledReason =
    hasSelectedHumans && !roster.hasOrganization
      ? t("Draft.organizationRequiredForGroup")
      : crossKindDisabledReason;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("Draft.title")}
          className={CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME}
        >
          <Plus className="size-4 md:size-3.5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-6 overflow-hidden shadow-none sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Draft.title")}</DialogTitle>
          <DialogDescription>{t("Draft.empty")}</DialogDescription>
        </DialogHeader>
        {!rosterLoaded ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("loading")}
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-1.5">
              {selectedTargets.map((target) => (
                <span
                  key={target.key}
                  className="bg-muted text-foreground inline-flex max-w-56 items-center gap-1.5 rounded-full py-1 pr-1 pl-1.5 text-sm"
                >
                  <Avatar className="size-5">
                    <AvatarImage src={target.image ?? undefined} alt="" />
                    <AvatarFallback className="text-[0.5625rem]">
                      {getInitials(target.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate">{target.name}</span>
                    {target.kind === "coworker" ? (
                      <AiCoworkerIcon className="size-3" />
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="hover:bg-background/80 flex size-5 items-center justify-center rounded-full"
                    onClick={() => removeTarget(target.key)}
                    aria-label={t("Draft.removeRecipient", {
                      name: target.name,
                    })}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                ref={searchInputRef}
                value={recipientQuery}
                onChange={(event) => setRecipientQuery(event.target.value)}
                placeholder={
                  selectedTargets.length === 0
                    ? t("Draft.searchPlaceholder")
                    : hasSelectedHumans
                      ? t("Draft.searchPlaceholderMore")
                      : t("Draft.searchPlaceholderReplace")
                }
                className="h-10 pl-9"
                autoComplete="off"
              />
            </div>
            <ScrollArea className="h-[min(16rem,40svh)]">
              {roster.membersLoadFailed ? (
                <MembersRosterLoadFailed className="m-1 px-3 py-6" />
              ) : null}
              {candidateTargets.length > 0 ? (
                <DirectDraftTargetList
                  targets={candidateTargets}
                  onSelect={addTarget}
                  isTargetDisabled={isTargetDisabled}
                  disabledReason={extraHumanDisabledReason}
                />
              ) : roster.membersLoadFailed ? null : (
                <p className="text-muted-foreground px-3 py-4 text-sm">
                  {t("Draft.noResults")}
                </p>
              )}
            </ScrollArea>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="primary"
            disabled={isPending || selectedTargets.length === 0}
            onClick={handleCreate}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {isPending ? t("CreateWizard.creating") : t("Dialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
