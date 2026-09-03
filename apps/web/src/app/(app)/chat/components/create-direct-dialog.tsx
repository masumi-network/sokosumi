"use client";

import { Loader2, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createDirectRoomAction,
  ensureCoworkerDirectRoomAction,
  ensureOrchestratorDirectRoomAction,
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
import { getInitials } from "@/lib/utils/text";
import {
  CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME,
  useChatComposeRoster,
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rosterScrollRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);
  const [open, setOpen] = useState(false);
  const { roster, rosterLoaded, rosterError, loadRoster, resetRoster } =
    useChatComposeRoster();
  const [recipientQuery, setRecipientQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const targets = useMemo(
    () =>
      buildDirectDraftTargets(
        roster.members,
        roster.coworkers,
        roster.orchestrators,
        roster.currentUserId,
      ),
    [
      roster.coworkers,
      roster.currentUserId,
      roster.members,
      roster.orchestrators,
    ],
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
  const selectedOrchestratorIds = selectedTargets
    .filter((target) => target.kind === "orchestrator")
    .map((target) => target.id);
  const hasSelectedHumans = selectedMemberUserIds.length > 0;
  const hasSelectedCoworker = selectedCoworkerIds.length > 0;
  const hasSelectedOrchestrator = selectedOrchestratorIds.length > 0;
  const hasSelectedAi = hasSelectedCoworker || hasSelectedOrchestrator;
  const crossKindDisabledReason = hasSelectedHumans
    ? t("Draft.groupDirectHumansOnly")
    : hasSelectedCoworker
      ? t("Draft.coworkerDirectOneToOneOnly")
      : hasSelectedOrchestrator
        ? t("Draft.personalAssistantDirectOneToOneOnly")
        : undefined;

  function isTargetDisabled(target: DirectDraftTarget): boolean {
    if (hasSelectedHumans && target.kind !== "human") {
      return true;
    }
    if (hasSelectedAi && target.kind === "human") {
      return true;
    }
    if (hasSelectedCoworker && target.kind === "orchestrator") {
      return true;
    }
    if (hasSelectedOrchestrator && target.kind === "coworker") {
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
    if (target.kind === "coworker" || target.kind === "orchestrator") {
      setSelectedKeys([target.key]);
    } else {
      setSelectedKeys((current) =>
        current.includes(target.key) ? current : [...current, target.key],
      );
    }
    setRecipientQuery("");
    rosterScrollRef.current?.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeTarget(key: string) {
    setSelectedKeys((current) => current.filter((item) => item !== key));
    rosterScrollRef.current?.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function resetDialog() {
    resetRoster();
    setRecipientQuery("");
    setSelectedKeys([]);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (inFlightRef.current || isPending) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      resetDialog();
      return;
    }
    loadRoster();
  }

  function handleCreate() {
    if (inFlightRef.current || isPending || selectedTargets.length === 0) {
      return;
    }
    inFlightRef.current = true;
    startTransition(async () => {
      const result =
        selectedCoworkerIds.length === 1
          ? await ensureCoworkerDirectRoomAction(selectedCoworkerIds[0])
          : selectedOrchestratorIds.length === 1
            ? await ensureOrchestratorDirectRoomAction(
                selectedOrchestratorIds[0],
              )
            : await createDirectRoomAction({
                memberUserIds: selectedMemberUserIds,
              });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Draft.chooseRecipientError"));
        inFlightRef.current = false;
        return;
      }
      if (!result.value) {
        toast.error(t("Draft.chooseRecipientError"));
        inFlightRef.current = false;
        return;
      }
      notifyOrganizationChatRoomsChanged(result.value);
      setOpen(false);
      resetDialog();
      window.location.assign(`/chat/rooms/${result.value.id}`);
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
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col overflow-hidden shadow-none sm:max-w-lg">
        <DialogHeader className="shrink-0 gap-1">
          <DialogTitle>{t("Draft.title")}</DialogTitle>
          <DialogDescription>{t("Draft.empty")}</DialogDescription>
        </DialogHeader>
        <div
          data-testid="direct-recipient-composer"
          className="border-input focus-within:border-ring focus-within:ring-ring/50 flex max-h-24 min-h-10 min-w-0 shrink-0 cursor-text flex-wrap items-center gap-2 overflow-y-auto rounded-md border px-2.5 py-1.5 focus-within:ring-[3px]"
          onClick={() => searchInputRef.current?.focus()}
        >
          <Search
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          {selectedTargets.map((target) => (
            <span
              key={target.key}
              className="bg-muted text-foreground inline-flex max-w-56 items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-1.5 text-sm"
            >
              <Avatar className="size-5">
                <AvatarImage src={target.image ?? undefined} alt="" />
                <AvatarFallback className="text-[0.5625rem]">
                  {getInitials(target.name)}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate">{target.name}</span>
                {target.kind === "coworker" ||
                target.kind === "orchestrator" ? (
                  <AiCoworkerIcon
                    className="size-3"
                    label={
                      target.kind === "orchestrator"
                        ? t("personalAssistantBadge")
                        : undefined
                    }
                  />
                ) : null}
              </span>
              <button
                type="button"
                className="hover:bg-background/80 flex size-5 items-center justify-center rounded-full"
                onClick={(event) => {
                  event.stopPropagation();
                  removeTarget(target.key);
                }}
                aria-label={t("Draft.removeRecipient", {
                  name: target.name,
                })}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <Input
            ref={searchInputRef}
            value={recipientQuery}
            onChange={(event) => {
              setRecipientQuery(event.target.value);
              rosterScrollRef.current?.scrollTo({ top: 0 });
            }}
            onClick={(event) => event.stopPropagation()}
            placeholder={
              selectedTargets.length === 0
                ? t("Draft.searchPlaceholder")
                : hasSelectedHumans
                  ? t("Draft.searchPlaceholderMore")
                  : t("Draft.searchPlaceholderReplace")
            }
            aria-label={t("Draft.searchPlaceholder")}
            className="h-7 min-w-32 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="relative min-h-0 flex-1 basis-[min(20rem,45svh)]">
          <div
            ref={rosterScrollRef}
            data-testid="direct-roster-scrollport"
            className="absolute inset-0 overflow-y-auto overscroll-contain"
            aria-busy={!rosterLoaded || undefined}
          >
            {!rosterLoaded ? (
              <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("loading")}
              </div>
            ) : rosterError ? (
              <div className="flex h-full items-center justify-center p-3">
                <MembersRosterLoadFailed
                  className="w-full px-3 py-6"
                  onRetry={loadRoster}
                  title={t("Empty.rosterLoadFailedTitle")}
                  description={t("Empty.rosterLoadFailedDescription")}
                />
              </div>
            ) : (
              <>
                {roster.membersLoadFailed ? (
                  <MembersRosterLoadFailed
                    className="mx-1 mt-1 px-3 py-4"
                    onRetry={loadRoster}
                  />
                ) : null}
                {candidateTargets.length > 0 ? (
                  <div className="pb-8">
                    <DirectDraftTargetList
                      targets={candidateTargets}
                      onSelect={addTarget}
                      isTargetDisabled={isTargetDisabled}
                      disabledReason={extraHumanDisabledReason}
                    />
                  </div>
                ) : roster.membersLoadFailed ? null : (
                  <p className="text-muted-foreground flex h-full items-center justify-center px-3 text-center text-sm">
                    {t("Draft.noResults")}
                  </p>
                )}
              </>
            )}
          </div>
          <div
            aria-hidden
            data-testid="direct-roster-edge-fade"
            className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t to-transparent"
          />
        </div>
        <DialogFooter className="shrink-0">
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
