"use client";
import type {
  Contact,
  ContactActivity,
  ContactChannelType,
  ContactDetail,
  ContactInteraction,
  ContactList,
} from "@sokosumi/core-client";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Bot,
  Building2,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  GitMerge,
  type LucideIcon,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PenLine,
  Phone,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  channelHref,
  channelLabel,
  coreErrorOf,
  IMPORTANCE_LEVELS,
  isFollowUpDue,
  LIST_COLOR_DOT,
  primaryEmail,
  sortChannels,
} from "@/app/contacts/contacts-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { contactsService } from "@/lib/services/contacts.client";
import { cn } from "@/lib/utils";
import { ChannelTypeSelect } from "./channel-type-select";
import {
  ChannelIcon,
  ContactAvatar,
  Dot,
  ListChip,
  PersonAvatar,
  ReplyChip,
  ScoreMeter,
  StageChip,
} from "./contact-visuals";
import { GroupedRadioItems, useStageOptions } from "./contacts-toolbar";
import { InlineField } from "./inline-field";
import { useContactUpdate, useImportanceUpdate } from "./use-contact-update";
import {
  contactKey,
  refreshContacts,
  type Teammate,
  writeContact,
} from "./use-contacts-data";

const INTERACTION_ICONS: Record<ContactInteraction["channel"], LucideIcon> = {
  EMAIL: Mail,
  MEETING: CalendarDays,
  SLACK: MessageSquare,
  CALL: Phone,
  MANUAL: PenLine,
  OTHER: MessageSquare,
};

interface Props {
  contactId: string;
  lists: ContactList[];
  teammates: Teammate[];
  onClose: () => void;
  /** Where focus goes when the panel closes, instead of the page. */
  onCloseAutoFocus?: (event: Event) => void;
  onOpenContact: (id: string) => void;
  onMerge: (contacts: Contact[]) => void;
}

/** One person: how to reach them, what the team knows, and every touchpoint. */
export function ContactPanel({
  contactId,
  lists,
  teammates,
  onClose,
  onCloseAutoFocus,
  onOpenContact,
  onMerge,
}: Props) {
  const t = useTranslations("App.Contacts.panel");
  const detail = useQuery({
    queryKey: contactKey(contactId),
    queryFn: () => contactsService.get(contactId),
  });
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {detail.data ? (
          <PanelBody
            contact={detail.data}
            lists={lists}
            teammates={teammates}
            onClose={onClose}
            onOpenContact={onOpenContact}
            onMerge={onMerge}
          />
        ) : detail.error ? (
          <div className="grid gap-3 p-6">
            <SheetTitle>{t("notFoundTitle")}</SheetTitle>
            <SheetDescription>{t("notFound")}</SheetDescription>
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => void detail.refetch()}
            >
              {t("retry")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 p-6" role="status">
            <SheetTitle className="sr-only">{t("loading")}</SheetTitle>
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-full" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            </div>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t px-6 py-5">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function PanelBody({
  contact,
  lists,
  teammates,
  onClose,
  onOpenContact,
  onMerge,
}: Omit<Props, "contactId"> & { contact: ContactDetail }) {
  const t = useTranslations("App.Contacts");
  const format = useFormatter();
  const now = useNow();
  const cache = useQueryClient();
  const update = useContactUpdate();
  const save = (fields: Parameters<typeof update>[1], optimistic = {}) =>
    update(contact, fields, optimistic);
  const setImportance = useImportanceUpdate();
  const importance = contact.score?.importance ?? null;
  const importanceNote =
    contact.score?.importanceSource === "JEV"
      ? contact.score.importanceReason
        ? t("importance.byJevBecause", {
            reason: contact.score.importanceReason
              .split(",")
              .map((key) => t(`importance.reasons.${key}`))
              .join(", "),
          })
        : t("importance.byJev")
      : contact.score?.importanceSource === "MANUAL"
        ? t("importance.byYou")
        : contact.score?.importanceSource === "SOKO_BOT"
          ? t("importance.byBot")
          : t("importance.notYet");
  const creator =
    teammates.find((person) => person.id === contact.createdByUserId) ?? null;
  const manualLists = lists.filter((list) => list.kind === "manual");

  async function toggleList(list: ContactList, on: boolean) {
    try {
      await contactsService.changeMembers(
        list.id,
        on ? { add: [contact.id] } : { remove: [contact.id] },
      );
      await refreshContacts(cache, contact.id);
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.saveFailed"));
    }
  }

  async function archive() {
    try {
      await contactsService.archive(contact.id);
      await refreshContacts(cache, contact.id);
      toast.success(t("panel.archived", { name: contact.name }));
      onClose();
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.saveFailed"));
    }
  }

  const subtitle = [contact.role, contact.organization]
    .filter(Boolean)
    .join(t("panel.roleAt"));
  const due = isFollowUpDue(contact.followUpAt, new Date());
  const email = primaryEmail(contact.channels);
  const stageOptions = useStageOptions();

  return (
    <div className="flex flex-col">
      <header className="flex items-start gap-4 px-6 pt-6 pb-5 pe-14">
        <ContactAvatar
          name={contact.name}
          src={contact.avatarUrl}
          email={email}
          kind={contact.kind}
          className="size-14 [&_[data-slot=avatar-fallback]]:text-base [&_svg]:size-6"
        />
        <div className="grid min-w-0 flex-1 gap-1">
          <SheetTitle className="sr-only">{contact.name}</SheetTitle>
          <InlineField
            label={t("panel.name")}
            value={contact.name}
            placeholder={t("panel.name")}
            maxLength={200}
            displayClassName="text-lg font-semibold tracking-tight"
            onSave={(name) => (name ? save({ name }) : Promise.resolve())}
          />
          <SheetDescription className="truncate">
            {contact.kind === "ORGANIZATION"
              ? [t("kinds.ORGANIZATION"), contact.organization]
                  .filter(Boolean)
                  .join(" · ")
              : subtitle || t("panel.noRole")}
          </SheetDescription>
          {email ? (
            <div className="-ms-2 flex min-w-0 items-center">
              <a
                href={`mailto:${email}`}
                className="hover:bg-quinary flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm"
              >
                <Mail
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="truncate">{email}</span>
              </a>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground size-10 shrink-0 md:size-8"
                aria-label={t("grid.copyEmail", { email })}
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(email)
                    .then(() => toast.success(t("grid.emailCopied")))
                }
              >
                <Copy aria-hidden className="size-4" />
              </Button>
            </div>
          ) : null}
          {contact.replyState ? (
            <p className="flex items-center gap-2 text-sm">
              <ReplyChip
                state={contact.replyState}
                since={contact.awaitingReplySince}
                now={now}
              />
              <span className="text-muted-foreground truncate text-xs">
                {contact.awaitingReplySince
                  ? t("panel.waitingSince", {
                      date: format.dateTime(
                        new Date(contact.awaitingReplySince),
                        { day: "numeric", month: "short" },
                      ),
                    })
                  : contact.lastInboundAt
                    ? t("panel.heardFrom", {
                        when: format.relativeTime(
                          new Date(contact.lastInboundAt),
                          now,
                        ),
                      })
                    : null}
              </span>
            </p>
          ) : null}
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {contact.createdBySokoBotId ? (
              <Bot aria-hidden className="size-3.5" />
            ) : creator ? (
              <PersonAvatar person={creator} className="size-4" />
            ) : null}
            {contact.createdBySokoBotId
              ? t("panel.addedByBot", {
                  when: format.relativeTime(new Date(contact.createdAt), now),
                })
              : t("panel.addedBy", {
                  name: creator?.name ?? t("panel.someone"),
                  when: format.relativeTime(new Date(contact.createdAt), now),
                })}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-10 shrink-0 md:size-8"
              aria-label={t("panel.menu")}
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(
                    `${window.location.origin}/contacts?contact=${contact.id}`,
                  )
                  .then(() => toast.success(t("panel.linkCopied")))
              }
            >
              <Copy aria-hidden className="size-4" />
              {t("panel.copyLink")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void save({
                  kind: contact.kind === "PERSON" ? "ORGANIZATION" : "PERSON",
                })
              }
            >
              {contact.kind === "PERSON" ? (
                <Building2 aria-hidden className="size-4" />
              ) : (
                <UserRound aria-hidden className="size-4" />
              )}
              {contact.kind === "PERSON"
                ? t("panel.markOrganization")
                : t("panel.markPerson")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void archive()}
            >
              <Trash2 aria-hidden className="size-4" />
              {t("panel.archive")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {contact.mergeSuggestions.length ? (
        <MergeBanner
          contact={contact}
          onOpenContact={onOpenContact}
          onMerge={onMerge}
        />
      ) : null}

      <dl className="grid gap-1 px-6 pb-5">
        <Property label={t("columns.stage")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("panel.changeStage", {
                  stage: t(`stages.${contact.stage}`),
                })}
                className="hover:bg-quinary focus-visible:ring-ring -mx-2 flex min-h-9 items-center rounded-md px-2 outline-none focus-visible:ring-2"
              >
                <StageChip stage={contact.stage} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-96 min-w-48 overflow-y-auto"
            >
              <DropdownMenuRadioGroup
                value={contact.stage}
                onValueChange={(stage) =>
                  void save({ stage: stage as Contact["stage"] })
                }
              >
                <GroupedRadioItems options={stageOptions} />
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Property>
        <Property label={t("columns.importance")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("importance.change")}
                className="hover:bg-quinary focus-visible:ring-ring -mx-2 flex min-h-9 w-[calc(100%+1rem)] flex-wrap items-center gap-x-3 rounded-md px-2 text-start outline-none focus-visible:ring-2"
              >
                <ScoreMeter
                  value={importance}
                  label={t("columns.importance")}
                />
                <span className="text-muted-foreground text-xs">
                  {importanceNote}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuRadioGroup
                value={
                  contact.score?.importanceSource &&
                  contact.score.importanceSource !== "JEV" &&
                  importance !== null
                    ? String(importance)
                    : ""
                }
                onValueChange={(value) =>
                  void setImportance(contact, value ? Number(value) : null)
                }
              >
                {IMPORTANCE_LEVELS.map((level) => (
                  <DropdownMenuRadioItem
                    key={level.id}
                    value={String(level.value)}
                  >
                    {t(`importance.${level.id}`)}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem value="">
                  {t("importance.auto")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Property>
        <Property label={t("columns.familiarity")}>
          <span className="flex min-h-9 flex-wrap items-center gap-x-3">
            <ScoreMeter
              value={contact.score?.familiarity ?? 0}
              label={t("columns.familiarity")}
            />
            <span className="text-muted-foreground text-xs">
              {t("importance.familiarityHint")}
            </span>
          </span>
        </Property>
        <Property label={t("columns.lists")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("panel.changeLists")}
                className="hover:bg-quinary focus-visible:ring-ring -mx-2 flex min-h-9 w-[calc(100%+1rem)] flex-wrap items-center gap-1 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
              >
                {contact.lists.length ? (
                  contact.lists.map((list) => (
                    <ListChip
                      key={list.id}
                      name={list.name}
                      color={list.color}
                      automatic={list.addedAutomatically}
                    />
                  ))
                ) : (
                  <span className="text-muted-foreground">
                    {t("panel.addToList")}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuLabel>{t("panel.manualLists")}</DropdownMenuLabel>
              {manualLists.map((list) => {
                const membership = contact.lists.find(
                  (item) => item.id === list.id,
                );
                return (
                  <DropdownMenuCheckboxItem
                    key={list.id}
                    checked={!!membership}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                      void toggleList(list, checked === true)
                    }
                  >
                    <Dot className={LIST_COLOR_DOT[list.color]} />
                    {list.name}
                    {membership?.addedAutomatically ? (
                      <span className="text-muted-foreground ms-auto ps-3 text-xs">
                        {t("panel.automatic")}
                      </span>
                    ) : null}
                  </DropdownMenuCheckboxItem>
                );
              })}
              {manualLists.length === 0 ? (
                <p className="text-muted-foreground px-2 py-1.5 text-sm">
                  {t("panel.noManualLists")}
                </p>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </Property>
        <Property label={t("columns.organization")}>
          <InlineField
            label={t("columns.organization")}
            value={contact.organization ?? ""}
            placeholder={t("panel.empty")}
            maxLength={200}
            onSave={(organization) =>
              save({ organization: organization || null })
            }
          />
        </Property>
        <Property label={t("columns.role")}>
          <InlineField
            label={t("columns.role")}
            value={contact.role ?? ""}
            placeholder={t("panel.empty")}
            maxLength={200}
            onSave={(role) => save({ role: role || null })}
          />
        </Property>
        <Property label={t("panel.location")}>
          <InlineField
            label={t("panel.location")}
            value={contact.location ?? ""}
            placeholder={t("panel.empty")}
            maxLength={200}
            onSave={(location) => save({ location: location || null })}
          />
        </Property>
      </dl>

      <ChannelsSection contact={contact} onOpenContact={onOpenContact} />

      <Section title={t("panel.nextStepTitle")}>
        <dl className="grid gap-1">
          <Property label={t("panel.nextStep")}>
            <InlineField
              label={t("panel.nextStep")}
              value={contact.nextStep ?? ""}
              placeholder={t("panel.nextStepPlaceholder")}
              maxLength={500}
              onSave={(nextStep) => save({ nextStep: nextStep || null })}
            />
          </Property>
          <Property label={t("columns.followUp")}>
            <div className="flex items-center gap-2">
              <InlineField
                label={t("columns.followUp")}
                type="date"
                value={contact.followUpAt ?? ""}
                display={
                  contact.followUpAt
                    ? format.dateTime(
                        new Date(`${contact.followUpAt}T00:00:00Z`),
                        { dateStyle: "medium", timeZone: "UTC" },
                      )
                    : undefined
                }
                placeholder={t("panel.noFollowUp")}
                displayClassName={cn(
                  "tabular-nums",
                  due && "text-semantic-destructive-label",
                )}
                onSave={(followUpAt) =>
                  save({ followUpAt: followUpAt || null })
                }
              />
              {due ? (
                <span className="text-semantic-destructive-label shrink-0 text-xs">
                  {t("grid.due")}
                </span>
              ) : null}
            </div>
          </Property>
        </dl>
      </Section>

      <Section title={t("panel.about")}>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">
              {t("panel.summary")}
            </span>
            <InlineField
              multiline
              label={t("panel.summary")}
              value={contact.summary ?? ""}
              placeholder={t("panel.summaryPlaceholder")}
              maxLength={4000}
              onSave={(summary) => save({ summary: summary || null })}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">
              {t("panel.whyInteresting")}
            </span>
            <InlineField
              multiline
              label={t("panel.whyInteresting")}
              value={contact.whyInteresting ?? ""}
              placeholder={t("panel.whyPlaceholder")}
              maxLength={2000}
              onSave={(whyInteresting) =>
                save({ whyInteresting: whyInteresting || null })
              }
            />
          </div>
        </div>
      </Section>

      <TimelineSection contact={contact} />
      <ActivitySection contact={contact} />
    </div>
  );
}

function MergeBanner({
  contact,
  onOpenContact,
  onMerge,
}: {
  contact: ContactDetail;
  onOpenContact: (id: string) => void;
  onMerge: (contacts: Contact[]) => void;
}) {
  const t = useTranslations("App.Contacts.panel");
  const duplicates = useQuery({
    queryKey: ["contact-duplicates", contact.id],
    queryFn: () => contactsService.duplicates(contact.id),
  });
  const group = duplicates.data?.find((item) =>
    item.contacts.some((entry) => entry.id === contact.id),
  );
  const others =
    group?.contacts.filter((entry) => entry.id !== contact.id) ?? [];
  if (!group || !others.length) return null;
  return (
    <div className="px-6 pb-5">
      <Alert className="border-primary-tertiary bg-primary-quinary">
        <GitMerge aria-hidden className="size-4" />
        <AlertDescription className="grid gap-2">
          <p className="text-foreground text-sm">
            {t("duplicate")}{" "}
            {others.map((other, index) => (
              <span key={other.id}>
                {index > 0 ? ", " : null}
                <button
                  type="button"
                  className="font-medium underline underline-offset-4"
                  onClick={() => onOpenContact(other.id)}
                >
                  {other.name}
                </button>
                {other.organization ? ` · ${other.organization}` : null}
              </span>
            ))}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => onMerge(group.contacts)}
          >
            <GitMerge aria-hidden className="size-4" />
            {t("reviewMerge")}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function ChannelsSection({
  contact,
  onOpenContact,
}: {
  contact: ContactDetail;
  onOpenContact: (id: string) => void;
}) {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ContactChannelType>("EMAIL");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [takenBy, setTakenBy] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setPending(true);
    setError("");
    setTakenBy(null);
    try {
      const saved = await contactsService.addChannel(contact.id, {
        type,
        value: value.trim(),
        source: "MANUAL",
      });
      writeContact(cache, saved);
      await refreshContacts(cache, contact.id);
      setValue("");
      setAdding(false);
    } catch (caught) {
      const failure = coreErrorOf(caught);
      if (failure.kind === "contact_channel_taken" && failure.existingContactId)
        setTakenBy(failure.existingContactId);
      setError(failure.message ?? t("errors.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  async function remove(channelId: string) {
    try {
      await contactsService.removeChannel(contact.id, channelId);
      await refreshContacts(cache, contact.id);
    } catch (caught) {
      toast.error(coreErrorOf(caught).message ?? t("errors.saveFailed"));
    }
  }

  function copy(id: string, text: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Section
      title={t("panel.channels")}
      action={
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          <Plus aria-hidden className="size-4" />
          {t("panel.addChannel")}
        </Button>
      }
    >
      <ul className="-mx-2 grid gap-0.5">
        {sortChannels(contact.channels).map((channel) => {
          const href = channelHref(channel);
          const label = channelLabel(channel);
          const primary =
            channel.isPrimary &&
            contact.channels.filter((item) => item.type === channel.type)
              .length > 1;
          return (
            <li
              key={channel.id}
              className="group/channel hover:bg-quinary flex min-h-10 items-center gap-3 rounded-md px-2"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-label={t("panel.channelSource", {
                      type: t(`channelTypes.${channel.type}`),
                      source: t(`sources.${channel.source}`),
                    })}
                    className="text-muted-foreground focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
                  >
                    <ChannelIcon type={channel.type} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t(`channelTypes.${channel.type}`)} ·{" "}
                  {t(`sources.${channel.source}`)}
                  {channel.verified ? ` · ${t("panel.verified")}` : ""}
                </TooltipContent>
              </Tooltip>
              <span className="min-w-0 flex-1">
                {href ? (
                  <a
                    href={href}
                    target={href.startsWith("http") ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="hover:decoration-foreground block truncate text-sm underline decoration-transparent underline-offset-4"
                  >
                    {label}
                  </a>
                ) : (
                  <span className="block truncate text-sm">{label}</span>
                )}
                {channel.label || primary ? (
                  <span className="text-muted-foreground block truncate text-xs">
                    {[primary ? t("panel.primary") : null, channel.label]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
              {channel.sourceUrl ? (
                <a
                  href={channel.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("panel.openSource")}
                  className="text-muted-foreground hover:text-foreground flex size-10 items-center justify-center rounded-md md:size-8"
                >
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              ) : null}
              <div className="flex shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-focus-within/channel:opacity-100 md:group-hover/channel:opacity-100">
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground size-10 md:size-8"
                  aria-label={t("panel.copyChannel", { value: label })}
                  onClick={() => copy(channel.id, channel.value)}
                >
                  {copied === channel.id ? (
                    <Check aria-hidden className="size-4" />
                  ) : (
                    <Copy aria-hidden className="size-4" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground size-10 md:size-8"
                  aria-label={t("panel.removeChannel", { value: label })}
                  onClick={() => void remove(channel.id)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {contact.channels.length === 0 && !adding ? (
        <p className="text-muted-foreground text-sm">{t("panel.noChannels")}</p>
      ) : null}
      {adding ? (
        <form onSubmit={handleAdd} className="mt-3 grid gap-2">
          <div className="flex items-center gap-2">
            <ChannelTypeSelect
              value={type}
              label={t("panel.channelType")}
              onChange={setType}
            />
            <Input
              aria-label={t("panel.channelValue")}
              value={value}
              autoFocus
              autoComplete="off"
              placeholder={t(`addDialog.placeholders.${type}`)}
              aria-invalid={!!error}
              onChange={(event) => setValue(event.target.value)}
            />
            <Button type="submit" loading={pending}>
              {t("panel.add")}
            </Button>
          </div>
          {error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <p role="alert" className="text-semantic-destructive-label">
                {error}
              </p>
              {takenBy ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenContact(takenBy)}
                >
                  {t("addDialog.openExisting")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}
    </Section>
  );
}

function TimelineSection({ contact }: { contact: ContactDetail }) {
  const t = useTranslations("App.Contacts.panel");
  const format = useFormatter();
  const timeline = useInfiniteQuery({
    queryKey: ["contact-timeline", contact.id, "interactions"],
    queryFn: ({ pageParam }) =>
      contactsService.interactions(contact.id, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = timeline.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Section
      title={t("timeline")}
      action={
        contact.interactionCount ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("interactionCount", { count: contact.interactionCount })}
          </span>
        ) : null
      }
    >
      {timeline.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noInteractions")}</p>
      ) : (
        <ol className="relative grid gap-4 before:bg-border before:absolute before:inset-y-2 before:start-3 before:w-px">
          {items.map((interaction) => {
            const Icon = INTERACTION_ICONS[interaction.channel];
            const when = new Date(interaction.occurredAt);
            return (
              <li key={interaction.id} className="relative flex gap-3">
                <span className="bg-background text-muted-foreground relative flex size-6 shrink-0 items-center justify-center rounded-full border">
                  <Icon aria-hidden className="size-3" />
                </span>
                <div className="grid min-w-0 flex-1 gap-1">
                  <p className="text-sm leading-5">{interaction.summary}</p>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                    <time
                      dateTime={when.toISOString()}
                      title={format.dateTime(when, "dateTimeShort")}
                      className="tabular-nums"
                    >
                      {format.dateTime(when, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                    <span aria-hidden>·</span>
                    {interaction.user ? (
                      <span className="inline-flex items-center gap-1">
                        <PersonAvatar
                          person={interaction.user}
                          className="size-4"
                        />
                        {interaction.user.name}
                      </span>
                    ) : interaction.sokoBot ? (
                      <span className="inline-flex items-center gap-1">
                        <Bot aria-hidden className="size-3.5" />
                        {interaction.sokoBot.name ?? t("sokoBot")}
                      </span>
                    ) : null}
                    <span aria-hidden>·</span>
                    <span>
                      {t(`interactionChannels.${interaction.channel}`)}
                    </span>
                    {interaction.sourceUrl ? (
                      <>
                        <span aria-hidden>·</span>
                        <a
                          href={interaction.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-4"
                        >
                          {t("source")}
                          <ExternalLink aria-hidden className="size-3" />
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {timeline.hasNextPage ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground mt-3"
          loading={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          {t("showMore")}
        </Button>
      ) : null}
    </Section>
  );
}

/** A change the background classifier made, recorded with its model source. */
function isAutomatic(entry: ContactActivity): boolean {
  return Object.values(entry.changes).some(
    (change) =>
      typeof change === "object" &&
      change !== null &&
      "source" in change &&
      String(change.source).startsWith("enrichment:"),
  );
}

function activityText(
  entry: ContactActivity,
  t: ReturnType<typeof useTranslations<"App.Contacts">>,
): string {
  const who = isAutomatic(entry)
    ? t("panel.classifier")
    : (entry.user?.name ?? entry.sokoBot?.name ?? t("panel.sokoBot"));
  if (entry.kind === "UPDATED") {
    const fields = Object.keys(entry.changes)
      .map((field) =>
        t.has(`panel.fields.${field}`) ? t(`panel.fields.${field}`) : field,
      )
      .join(", ");
    return t("panel.activity.UPDATED", { who, fields });
  }
  if (entry.kind === "MERGED") {
    const names = Array.isArray(entry.changes.mergedNames)
      ? entry.changes.mergedNames.join(", ")
      : "";
    return t("panel.activity.MERGED", { who, names });
  }
  return t(`panel.activity.${entry.kind}`, { who });
}

function ActivitySection({ contact }: { contact: ContactDetail }) {
  const t = useTranslations("App.Contacts");
  const format = useFormatter();
  const now = useNow();
  const activity = useInfiniteQuery({
    queryKey: ["contact-timeline", contact.id, "activity"],
    queryFn: ({ pageParam }) =>
      contactsService.activity(contact.id, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = activity.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Section title={t("panel.activityTitle")}>
      {activity.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ul className="grid gap-2.5">
          {items.map((entry) => (
            <li
              key={entry.id}
              className="text-muted-foreground flex items-start gap-2 text-xs"
            >
              {isAutomatic(entry) ? (
                <Sparkles aria-hidden className="size-4 shrink-0" />
              ) : entry.user ? (
                <PersonAvatar person={entry.user} className="size-4" />
              ) : (
                <Bot aria-hidden className="size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="text-foreground">
                  {activityText(entry, t)}
                </span>
                {" · "}
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {format.relativeTime(new Date(entry.createdAt), now)}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
      {activity.hasNextPage ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground mt-3"
          loading={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          {t("panel.showMore")}
        </Button>
      ) : null}
    </Section>
  );
}
