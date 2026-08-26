"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  checkChannelSlugAvailabilityAction,
  createChannelAction,
  updateRoomAction,
} from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { Coworker, Member } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  CHANNEL_NAME_MAX,
  CHANNEL_SLUG_MAX,
  CHANNEL_TOPIC_MAX,
  type ChannelSlugCheckState,
  type CreateChannelWizard,
  canCreateChannel,
  createChannelSubmitFields,
  createInitialWizard,
  type Discoverability,
  remainingNameChars,
  remainingTopicChars,
  setAddPeopleMode,
  setDiscoverability,
  setName,
  setSlug,
  setSpecificMembers,
  setTopic,
  toAddPeople,
} from "./create-channel-wizard";
import { ParticipantCheckboxes } from "./participant-checkboxes";

interface CreateChannelDialogProps {
  open: boolean;
  members: Member[];
  coworkers: Coworker[];
  organizationName: string;
  currentUserId: string;
  membersLoadFailed?: boolean;
  /** Org owner/admin only — create discoverability external. */
  canCreateExternal?: boolean;
}

function isDiscoverability(value: string): value is Discoverability {
  return value === "public" || value === "private" || value === "external";
}

export function CreateChannelDialog({
  open,
  members,
  coworkers,
  organizationName,
  currentUserId,
  membersLoadFailed = false,
  canCreateExternal = false,
}: CreateChannelDialogProps) {
  const t = useTranslations("App.Channels.CreateWizard");
  const tVisibility = useTranslations("App.Channels.Visibility");
  const router = useRouter();
  const [wizard, setWizard] =
    useState<CreateChannelWizard>(createInitialWizard);
  const [availability, setAvailability] =
    useState<ChannelSlugCheckState>("invalid");
  const [isPending, startTransition] = useTransition();

  const slugFieldError =
    wizard.step === "create"
      ? availability === "taken"
        ? t("slugTaken")
        : availability === "error"
          ? t("slugCheckFailed")
          : availability === "invalid" && wizard.slugDirty
            ? t("slugInvalid")
            : null
      : null;
  const orgMemberCount = members.length;
  const allMemberUserIds = members.map((member) => member.user.id);

  function navigateToRoom(roomId: string) {
    router.replace(`/chat/rooms/${roomId}`);
  }

  function clearCreateQuery() {
    router.replace("/");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen || isPending) {
      return;
    }
    if (wizard.step === "add-people") {
      navigateToRoom(wizard.roomId);
      return;
    }
    clearCreateQuery();
  }

  const createStepSlug = wizard.step === "create" ? wizard.slug : "";

  useEffect(() => {
    if (wizard.step !== "create") {
      return;
    }
    if (!createStepSlug) {
      setAvailability("invalid");
      return;
    }
    setAvailability("unknown");
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await checkChannelSlugAvailabilityAction(createStepSlug);
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setAvailability("error");
        return;
      }
      setAvailability(result.value.status);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [wizard.step, createStepSlug]);

  function handleCreate() {
    if (
      wizard.step !== "create" ||
      isPending ||
      !canCreateChannel(wizard, availability)
    ) {
      return;
    }
    const fields = createChannelSubmitFields(wizard);
    if (!fields) {
      return;
    }
    const { name, slug, topic, discoverability } = fields;
    startTransition(async () => {
      const result = await createChannelAction({
        name,
        slug,
        topic,
        discoverability,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      notifyOrganizationChatRoomsChanged(result.value);
      setWizard(
        toAddPeople(
          wizard,
          { id: result.value.id, name: result.value.name },
          currentUserId,
        ),
      );
    });
  }

  function finishAddPeople(options: {
    memberUserIds: string[];
    coworkerIds: string[];
    skipUpdate: boolean;
  }) {
    if (wizard.step !== "add-people" || isPending) {
      return;
    }
    const roomId = wizard.roomId;
    if (options.skipUpdate) {
      navigateToRoom(roomId);
      return;
    }
    startTransition(async () => {
      const result = await updateRoomAction(roomId, {
        memberUserIds: options.memberUserIds,
        coworkerIds: options.coworkerIds,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      notifyOrganizationChatRoomsChanged(result.value);
      navigateToRoom(roomId);
    });
  }

  function handleAddPeople() {
    if (wizard.step !== "add-people") {
      return;
    }
    if (wizard.mode === "all") {
      finishAddPeople({
        memberUserIds: allMemberUserIds.includes(currentUserId)
          ? allMemberUserIds
          : [currentUserId, ...allMemberUserIds],
        coworkerIds: [],
        skipUpdate: false,
      });
      return;
    }
    const memberUserIds = wizard.memberUserIds.includes(currentUserId)
      ? wizard.memberUserIds
      : [currentUserId, ...wizard.memberUserIds];
    const extraHumans = memberUserIds.filter((id) => id !== currentUserId);
    finishAddPeople({
      memberUserIds,
      coworkerIds: wizard.coworkerIds,
      skipUpdate: extraHumans.length === 0 && wizard.coworkerIds.length === 0,
    });
  }

  function handleSkip() {
    if (wizard.step !== "add-people") {
      return;
    }
    finishAddPeople({
      memberUserIds: [],
      coworkerIds: [],
      skipUpdate: true,
    });
  }

  const isCreateStep = wizard.step === "create";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] gap-6 overflow-y-auto shadow-none sm:max-w-lg"
        {...(wizard.step === "create" && wizard.slug
          ? {}
          : { "aria-describedby": undefined })}
      >
        <DialogHeader className={cn(isCreateStep && "gap-1.5")}>
          <DialogTitle>
            {wizard.step === "add-people"
              ? t("addPeopleTitle", { name: wizard.roomName })
              : t("title")}
          </DialogTitle>
          {wizard.step === "create" && wizard.slug ? (
            <DialogDescription className="text-muted-foreground text-xs font-normal">
              {t("handleChrome", { slug: wizard.slug })}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {wizard.step === "create" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-channel-slug">{t("slugLabel")}</Label>
              <div className="relative">
                <span
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm"
                  aria-hidden
                >
                  #
                </span>
                <Input
                  id="create-channel-slug"
                  value={wizard.slug}
                  onChange={(event) =>
                    setWizard(setSlug(wizard, event.target.value))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder={t("slugPlaceholder")}
                  className="pl-7"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  maxLength={CHANNEL_SLUG_MAX}
                  aria-invalid={slugFieldError !== null}
                  aria-describedby="create-channel-slug-status"
                />
              </div>
              <p
                id="create-channel-slug-status"
                role={slugFieldError ? "alert" : undefined}
                className={cn(
                  "text-xs",
                  slugFieldError ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {slugFieldError ??
                  (availability === "unknown"
                    ? t("slugChecking")
                    : t("slugHelp"))}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-channel-name">{t("nameLabel")}</Label>
              <div className="relative">
                <Input
                  id="create-channel-name"
                  value={wizard.name}
                  onChange={(event) =>
                    setWizard(setName(wizard, event.target.value))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder={t("namePlaceholder")}
                  className="pr-10"
                  maxLength={CHANNEL_NAME_MAX}
                />
                <span
                  className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs tabular-nums"
                  aria-hidden
                >
                  {remainingNameChars(wizard.name)}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">{t("nameHelp")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-channel-topic">{t("topicLabel")}</Label>
              <div className="relative">
                <Textarea
                  id="create-channel-topic"
                  value={wizard.topic}
                  onChange={(event) =>
                    setWizard(setTopic(wizard, event.target.value))
                  }
                  placeholder={t("topicPlaceholder")}
                  maxLength={CHANNEL_TOPIC_MAX}
                />
                <span
                  className="text-muted-foreground pointer-events-none absolute right-3 bottom-2 text-xs tabular-nums"
                  aria-hidden
                >
                  {remainingTopicChars(wizard.topic)}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{tVisibility("label")}</Label>
              <RadioGroup
                value={wizard.discoverability}
                onValueChange={(value) => {
                  if (!isDiscoverability(value)) {
                    return;
                  }
                  if (value === "external" && !canCreateExternal) {
                    return;
                  }
                  setWizard(setDiscoverability(wizard, value));
                }}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="public" id="create-channel-public" />
                  <Label
                    htmlFor="create-channel-public"
                    className="cursor-pointer font-normal"
                  >
                    {tVisibility("public")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="private" id="create-channel-private" />
                  <Label
                    htmlFor="create-channel-private"
                    className="cursor-pointer font-normal"
                  >
                    {tVisibility("private")}
                  </Label>
                </div>
                {canCreateExternal ? (
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="external"
                      id="create-channel-external"
                    />
                    <Label
                      htmlFor="create-channel-external"
                      className="cursor-pointer font-normal"
                    >
                      {tVisibility("external")}
                    </Label>
                  </div>
                ) : null}
              </RadioGroup>
              <p className="text-muted-foreground text-xs">
                {wizard.discoverability === "public"
                  ? tVisibility("publicHelp")
                  : wizard.discoverability === "private"
                    ? tVisibility("privateHelp")
                    : tVisibility("externalHelp")}
              </p>
            </div>
          </div>
        ) : null}

        {wizard.step === "add-people" ? (
          <div className="space-y-4">
            <RadioGroup
              value={wizard.mode}
              onValueChange={(value) => {
                if (value === "all" || value === "specific") {
                  setWizard(setAddPeopleMode(wizard, value));
                }
              }}
              className="gap-4"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem
                  value="all"
                  id="create-channel-add-all"
                  className="mt-0.5"
                />
                <Label
                  htmlFor="create-channel-add-all"
                  className="cursor-pointer font-normal"
                >
                  {t("addAll", {
                    count: orgMemberCount,
                    organization: organizationName,
                  })}
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem
                  value="specific"
                  id="create-channel-add-specific"
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <Label
                    htmlFor="create-channel-add-specific"
                    className="cursor-pointer font-normal"
                  >
                    {t("addSpecific")}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {t("addSpecificHelp")}
                  </p>
                </div>
              </div>
            </RadioGroup>

            {wizard.mode === "specific" ? (
              <ParticipantCheckboxes
                members={members}
                coworkers={coworkers}
                memberIds={wizard.memberUserIds}
                coworkerIds={wizard.coworkerIds}
                lockedUserId={currentUserId}
                onMemberIdsChange={(memberUserIds) =>
                  setWizard(
                    setSpecificMembers(wizard, {
                      memberUserIds,
                      coworkerIds: wizard.coworkerIds,
                    }),
                  )
                }
                onCoworkerIdsChange={(coworkerIds) =>
                  setWizard(
                    setSpecificMembers(wizard, {
                      memberUserIds: wizard.memberUserIds,
                      coworkerIds,
                    }),
                  )
                }
                membersLoadFailed={membersLoadFailed}
              />
            ) : null}
          </div>
        ) : null}

        {isCreateStep ? (
          <DialogFooter>
            <Button
              type="button"
              variant="primary"
              disabled={isPending || !canCreateChannel(wizard, availability)}
              onClick={handleCreate}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {isPending ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        ) : null}

        {wizard.step === "add-people" ? (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={handleSkip}
            >
              {t("skip")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isPending}
              onClick={handleAddPeople}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {isPending ? t("adding") : t("add")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
