"use client";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { createChannelAction } from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SIDEBAR_ICON_ACTION_CLASS } from "@/components/ui/sidebar-classes";
import { Textarea } from "@/components/ui/textarea";
import { useChannelSlugAvailability } from "@/hooks/effects/use-channel-slug-availability";
import { cn } from "@/lib/utils";
import { useChatComposeRoster } from "./chat-compose-dialog";
import {
  backToCreate,
  CHANNEL_NAME_MAX,
  CHANNEL_SLUG_MAX,
  CHANNEL_TOPIC_MAX,
  type CreateChannelWizard,
  canCreateChannel,
  createChannelSubmitFields,
  createInitialWizard,
  type Discoverability,
  editLink,
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
import { MembersRosterLoadFailed } from "./room-draft-shared";

function isDiscoverability(value: string): value is Discoverability {
  return value === "public" || value === "private" || value === "external";
}

interface CreateChannelDialogProps {
  /** Opens the dialog in place of the sidebar's `+`. */
  trigger?: ReactNode;
}

export function CreateChannelDialog({
  trigger,
}: CreateChannelDialogProps = {}) {
  const t = useTranslations("App.Channels.CreateWizard");
  const tChannels = useTranslations("App.Channels");
  const tVisibility = useTranslations("App.Channels.Visibility");
  const inFlightRef = useRef(false);
  // Set when a create-time conflict sends the person back to fix the link.
  const focusLinkRef = useRef(false);
  // The Link field mounts in place of the control that opened it (Change link,
  // or Create after a conflict), so it takes focus when that control's focus
  // was dropped, or when a conflict asked for it.
  const linkInputRef = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    if (focusLinkRef.current || document.activeElement === document.body) {
      focusLinkRef.current = false;
      input.focus();
    }
  }, []);
  const [open, setOpen] = useState(false);
  const { roster, rosterLoaded, rosterError, loadRoster, resetRoster } =
    useChatComposeRoster();
  const [wizard, setWizard] =
    useState<CreateChannelWizard>(createInitialWizard);
  const createStepSlug = wizard.step === "create" ? wizard.slug : "";
  const { availability, setAvailability } = useChannelSlugAvailability(
    wizard,
    createStepSlug,
  );
  const [isPending, startTransition] = useTransition();
  // Core said this link was taken on create; the recheck must not hide it.
  const [conflictSlug, setConflictSlug] = useState<string | null>(null);
  // While a new link is checked, the field keeps the last answer's shape
  // instead of closing and reopening on every keystroke.
  const [settled, setSettled] = useState(availability);
  // A field the person is in stays put; it closes after focus moves on.
  const [linkFocused, setLinkFocused] = useState(false);
  if (availability !== "unknown" && availability !== settled) {
    setSettled(availability);
  }

  const {
    members,
    coworkers,
    sokoBots,
    organizationName,
    currentUserId,
    membersLoadFailed,
    canCreateExternal,
    hasOrganization,
  } = roster;
  const linkConflict = wizard.step === "create" && wizard.slug === conflictSlug;
  function linkError(state: typeof availability): string | null {
    if (wizard.step !== "create") return null;
    if (linkConflict || state === "taken") return t("slugTaken");
    if (state === "error") return t("slugCheckFailed");
    if (
      // The check calls an empty link invalid; a stale answer for a typed one is not.
      state === "invalid" &&
      wizard.slug === "" &&
      (wizard.slugDirty || wizard.name.trim().length > 0)
    ) {
      return t("slugInvalid");
    }
    return null;
  }
  const slugFieldError = linkError(availability);
  const canAdvance = !linkConflict && canCreateChannel(wizard, availability);
  // The link field opens when the person asks, or when the derived link can't be used.
  const showLinkField =
    wizard.step === "create" &&
    (wizard.slugDirty ||
      linkFocused ||
      linkError(availability === "unknown" ? settled : availability) !== null);
  const orgMemberCount = members.length;
  const allMemberUserIds = members.map((member) => member.user.id);

  function resetDialog() {
    setWizard(createInitialWizard());
    setAvailability("invalid");
    setConflictSlug(null);
    setLinkFocused(false);
    resetRoster();
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

  function navigateToRoom(roomId: string) {
    setOpen(false);
    resetDialog();
    window.location.assign(`/chat/rooms/${roomId}`);
  }

  function handleAdvanceToPeople() {
    if (
      wizard.step !== "create" ||
      isPending ||
      membersLoadFailed ||
      !canAdvance
    ) {
      return;
    }
    // Enter in Link leaves the step without a blur.
    setLinkFocused(false);
    setWizard(toAddPeople(wizard, currentUserId));
  }

  function submitCreate(roster: {
    memberUserIds: string[];
    coworkerIds: string[];
    sokoBotIds: string[];
  }) {
    if (wizard.step !== "add-people" || inFlightRef.current || isPending) {
      return;
    }
    const fields = createChannelSubmitFields(wizard, roster);
    if (!fields) {
      return;
    }
    inFlightRef.current = true;
    startTransition(async () => {
      const result = await createChannelAction({
        name: fields.name,
        slug: fields.slug,
        topic: fields.topic,
        discoverability: fields.discoverability,
        memberUserIds: fields.memberUserIds,
        coworkerIds: fields.coworkerIds,
        sokoBotIds: fields.sokoBotIds,
      });
      if (!result.ok) {
        inFlightRef.current = false;
        if (result.error.code === CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN) {
          setAvailability("taken");
          setConflictSlug(wizard.slug);
          focusLinkRef.current = true;
          setWizard(backToCreate(wizard));
          return;
        }
        toast.error(result.error.message);
        return;
      }
      notifyOrganizationChatRoomsChanged(result.value);
      navigateToRoom(result.value.id);
    });
  }

  function handleCreate() {
    if (wizard.step !== "add-people" || membersLoadFailed) {
      return;
    }
    if (wizard.mode === "all") {
      submitCreate({
        memberUserIds: allMemberUserIds.includes(currentUserId)
          ? allMemberUserIds
          : [currentUserId, ...allMemberUserIds],
        coworkerIds: [],
        sokoBotIds: [],
      });
      return;
    }
    const memberUserIds = wizard.memberUserIds.includes(currentUserId)
      ? wizard.memberUserIds
      : [currentUserId, ...wizard.memberUserIds];
    submitCreate({
      memberUserIds,
      coworkerIds: wizard.coworkerIds,
      sokoBotIds: wizard.sokoBotIds,
    });
  }

  const isCreateStep = wizard.step === "create";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={tChannels("createChannel")}
            className={SIDEBAR_ICON_ACTION_CLASS}
          >
            <Plus className="size-4 md:size-3.5" aria-hidden />
          </button>
        )}
      </DialogTrigger>
      <DialogContent
        className="app-scrollbar max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto shadow-none sm:max-w-lg"
        {...(isCreateStep ? { "aria-describedby": undefined } : {})}
      >
        <DialogHeader className={cn(isCreateStep && "gap-1.5")}>
          <DialogTitle>
            {wizard.step === "add-people"
              ? t("addPeopleTitle", { name: wizard.name })
              : t("title")}
          </DialogTitle>
          {!isCreateStep && wizard.slug ? (
            <DialogDescription className="text-muted-foreground text-xs font-normal">
              {t("handleChrome", { slug: wizard.slug })}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {!rosterLoaded ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-pulse"
              aria-hidden
            />
            {tChannels("loading")}
          </div>
        ) : null}

        {rosterLoaded && rosterError ? (
          <MembersRosterLoadFailed
            onRetry={loadRoster}
            title={tChannels("Empty.rosterLoadFailedTitle")}
            description={tChannels("Empty.rosterLoadFailedDescription")}
          />
        ) : null}

        {rosterLoaded && !rosterError && !hasOrganization ? (
          <p className="text-muted-foreground text-sm">
            {tChannels("NoOrganization.description")}
          </p>
        ) : null}

        {rosterLoaded &&
        hasOrganization &&
        !rosterError &&
        membersLoadFailed ? (
          <MembersRosterLoadFailed onRetry={loadRoster} />
        ) : null}

        {rosterLoaded &&
        hasOrganization &&
        !rosterError &&
        !membersLoadFailed &&
        wizard.step === "create" ? (
          <div className="space-y-4">
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
                      handleAdvanceToPeople();
                    }
                  }}
                  placeholder={t("namePlaceholder")}
                  className="pr-10"
                  autoFocus
                  maxLength={CHANNEL_NAME_MAX}
                  aria-describedby={
                    showLinkField ? undefined : "create-channel-link-help"
                  }
                />
                <span
                  className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs tabular-nums"
                  aria-hidden
                >
                  {remainingNameChars(wizard.name)}
                </span>
              </div>
              {showLinkField ? null : (
                <p
                  id="create-channel-link-help"
                  className="text-muted-foreground text-xs text-pretty"
                >
                  {wizard.slug ? (
                    <>
                      {t.rich("linkHelp", {
                        slug: wizard.slug,
                        link: (chunks) => (
                          <span className="text-foreground font-medium break-words">
                            {chunks}
                          </span>
                        ),
                      })}{" "}
                      {availability === "unknown"
                        ? t("slugChecking")
                        : t("linkPermanent")}{" "}
                      <button
                        type="button"
                        // The button leaves with the help line; the Link field takes focus as it mounts.
                        onClick={() => setWizard(editLink(wizard))}
                        className="text-foreground py-1 underline underline-offset-4"
                      >
                        {t("changeLink")}
                      </button>
                    </>
                  ) : (
                    t("linkEmpty")
                  )}
                </p>
              )}
            </div>
            {showLinkField ? (
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
                    ref={linkInputRef}
                    id="create-channel-slug"
                    onFocus={() => setLinkFocused(true)}
                    onBlur={() => setLinkFocused(false)}
                    value={wizard.slug}
                    onChange={(event) =>
                      setWizard(setSlug(wizard, event.target.value))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAdvanceToPeople();
                      }
                    }}
                    placeholder={t("slugPlaceholder")}
                    className="pl-7"
                    autoComplete="off"
                    spellCheck={false}
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
                    slugFieldError
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {slugFieldError ??
                    (availability === "unknown"
                      ? t("slugChecking")
                      : t("slugHelp"))}
                </p>
              </div>
            ) : null}
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

        {rosterLoaded &&
        hasOrganization &&
        !rosterError &&
        !membersLoadFailed &&
        wizard.step === "add-people" ? (
          // min-w-0: a grid item, so a long email in the people list would
          // otherwise widen the dialog past a phone screen.
          <div className="min-w-0 space-y-4">
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
                sokoBots={sokoBots}
                memberIds={wizard.memberUserIds}
                coworkerIds={wizard.coworkerIds}
                sokoBotIds={wizard.sokoBotIds}
                lockedUserId={currentUserId}
                onMemberIdsChange={(memberUserIds) =>
                  setWizard(
                    setSpecificMembers(wizard, {
                      memberUserIds,
                      coworkerIds: wizard.coworkerIds,
                      sokoBotIds: wizard.sokoBotIds,
                    }),
                  )
                }
                onCoworkerIdsChange={(coworkerIds) =>
                  setWizard(
                    setSpecificMembers(wizard, {
                      memberUserIds: wizard.memberUserIds,
                      coworkerIds,
                      sokoBotIds: wizard.sokoBotIds,
                    }),
                  )
                }
                onSokoBotIdsChange={(sokoBotIds) =>
                  setWizard(
                    setSpecificMembers(wizard, {
                      memberUserIds: wizard.memberUserIds,
                      coworkerIds: wizard.coworkerIds,
                      sokoBotIds,
                    }),
                  )
                }
                membersLoadFailed={membersLoadFailed}
              />
            ) : null}
          </div>
        ) : null}

        {rosterLoaded &&
        hasOrganization &&
        !rosterError &&
        !membersLoadFailed &&
        isCreateStep ? (
          <DialogFooter>
            <Button
              type="button"
              variant="primary"
              disabled={isPending || !canAdvance}
              onClick={handleAdvanceToPeople}
            >
              {t("next")}
            </Button>
          </DialogFooter>
        ) : null}

        {rosterLoaded &&
        hasOrganization &&
        !rosterError &&
        !membersLoadFailed &&
        wizard.step === "add-people" ? (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={() => setWizard(backToCreate(wizard))}
            >
              {t("back")}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isPending}
              onClick={handleCreate}
            >
              {t("create")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
