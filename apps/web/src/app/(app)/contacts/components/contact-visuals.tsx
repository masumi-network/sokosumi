"use client";
import type {
  ContactChannelType,
  ContactKind,
  ContactListColor,
  ContactPerson,
  ContactReplyState,
  ContactStage,
} from "@sokosumi/core-client";
import gravatarUrl from "gravatar-url";
import {
  AtSign,
  Building2,
  Globe,
  Mail,
  MessageCircle,
  Phone,
  Send,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps, ComponentType } from "react";
import {
  daysSince,
  initials,
  LIST_COLOR_DOT,
  REPLY_DOT,
  STAGE_DOT,
} from "@/app/contacts/contacts-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type GlyphProps = ComponentProps<"svg">;

// Monochrome brand glyphs (Simple Icons; LinkedIn is Font Awesome's) that
// follow the text color, so a row of channels reads as one quiet set.
function SlackGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

function LinkedInGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 32 448 448" fill="currentColor" {...props}>
      <path d="M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3zM135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.2 0 79.7 44.3 79.7 101.9V416z" />
    </svg>
  );
}

function XGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

function GitHubGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const CHANNEL_GLYPH: Record<ContactChannelType, ComponentType<GlyphProps>> = {
  EMAIL: Mail,
  PHONE: Phone,
  SLACK: SlackGlyph,
  LINKEDIN: LinkedInGlyph,
  X: XGlyph,
  WEBSITE: Globe,
  TELEGRAM: Send,
  WHATSAPP: MessageCircle,
  GITHUB: GitHubGlyph,
  OTHER: AtSign,
};

/** A channel's mark. Brand glyphs read a size smaller than line icons. */
export function ChannelIcon({
  type,
  className,
}: {
  type: ContactChannelType;
  className?: string;
}) {
  const Glyph = CHANNEL_GLYPH[type];
  const brand =
    type === "SLACK" ||
    type === "LINKEDIN" ||
    type === "X" ||
    type === "GITHUB";
  return (
    <Glyph
      aria-hidden
      className={cn("shrink-0", brand ? "size-3.5" : "size-4", className)}
    />
  );
}

/**
 * A contact's initials in a neutral circle; an organization or shared inbox
 * gets a building in a rounded square instead, so it never passes for a person.
 */
/**
 * A person's photo: the one saved on the contact, else their Gravatar, else
 * their initials. Gravatar answers 404 for an address it does not know, so
 * the initials show instead of a generic face.
 */
export function ContactAvatar({
  name,
  src,
  email,
  kind = "PERSON",
  className,
}: {
  name: string;
  src?: string | null;
  email?: string | null;
  kind?: ContactKind;
  className?: string;
}) {
  const photo =
    src ?? (email ? gravatarUrl(email, { size: 80, default: "404" }) : null);
  if (kind === "ORGANIZATION")
    return (
      <span
        aria-hidden
        className={cn(
          "bg-quinary text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md",
          className,
        )}
      >
        <Building2 className="size-3.5" />
      </span>
    );
  return (
    <Avatar aria-hidden className={cn("size-6", className)}>
      {photo ? <AvatarImage src={photo} alt="" /> : null}
      <AvatarFallback className="bg-quinary text-muted-foreground text-2xs font-medium">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** A teammate. */
export function PersonAvatar({
  person,
  className,
}: {
  person: Pick<ContactPerson, "name" | "image">;
  className?: string;
}) {
  return (
    <Avatar aria-hidden className={cn("size-5", className)}>
      {person.image ? <AvatarImage src={person.image} alt="" /> : null}
      <AvatarFallback className="bg-quaternary text-foreground text-2xs font-medium">
        {initials(person.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Up to three teammates, overlapping, then a count. */
export function AvatarStack({
  people,
  label,
}: {
  people: Pick<ContactPerson, "id" | "name" | "image">[];
  label: string;
}) {
  const shown = people.slice(0, 3);
  const rest = people.length - shown.length;
  return (
    <span
      role="img"
      aria-label={label}
      title={people.map((person) => person.name).join(", ")}
      className="flex items-center"
    >
      {shown.map((person) => (
        <PersonAvatar
          key={person.id}
          person={person}
          className="ring-card-background group-hover/row:ring-card-background-hover -ms-0.5 size-6 ring-2 first:ms-0"
        />
      ))}
      {rest > 0 ? (
        <span className="text-muted-foreground ms-1 text-2xs tabular-nums">
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

export function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", className)}
    />
  );
}

/**
 * A 0–100 score as a short bar and its number, in the accent color. Null
 * reads as a dash: not judged yet.
 */
export function ScoreMeter({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="inline-flex items-center gap-2"
    >
      <span className="bg-quinary h-1.5 w-14 overflow-hidden rounded-full">
        <span
          className="bg-primary block h-full rounded-full"
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="text-muted-foreground w-6 text-xs tabular-nums">
        {value}
      </span>
    </span>
  );
}

export function StageChip({ stage }: { stage: ContactStage }) {
  const t = useTranslations("App.Contacts.stages");
  return (
    <span className="bg-quinary text-foreground inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2 text-xs whitespace-nowrap">
      <Dot className={STAGE_DOT[stage]} />
      <span className="truncate">{t(stage)}</span>
    </span>
  );
}

/**
 * A list a contact is on. `automatic` marks one the classifier chose, so a
 * person can tell it from their own and undo it.
 */
export function ListChip({
  name,
  color,
  automatic = false,
}: {
  name: string;
  color: ContactListColor;
  automatic?: boolean;
}) {
  const t = useTranslations("App.Contacts.grid");
  return (
    <span
      title={automatic ? t("addedAutomatically", { list: name }) : undefined}
      className={cn(
        "text-foreground inline-flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs whitespace-nowrap",
        automatic ? "border-dashed" : "border-border",
      )}
    >
      <Dot className={LIST_COLOR_DOT[color]} />
      <span className="truncate">{name}</span>
      {automatic ? (
        <>
          <Sparkles
            aria-hidden
            className="text-muted-foreground size-3 shrink-0"
          />
          <span className="sr-only">
            {t("addedAutomatically", { list: name })}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Where the team's latest outreach stands. Waiting states say for how long;
 * the dot is the only color, and only unanswered states take a warm one.
 */
export function ReplyChip({
  state,
  since,
  now,
}: {
  state: ContactReplyState;
  since: Date | string | null;
  now: Date;
}) {
  const t = useTranslations("App.Contacts");
  const waiting =
    since && (state === "NO_REPLY" || state === "AWAITING_REPLY")
      ? daysSince(since, now)
      : null;
  return (
    <span className="bg-quinary text-foreground inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2 text-xs whitespace-nowrap">
      <Dot className={REPLY_DOT[state]} />
      <span className="truncate">{t(`replyStates.${state}`)}</span>
      {waiting !== null ? (
        <span className="text-muted-foreground tabular-nums">
          {t("grid.waitingDays", { days: waiting })}
        </span>
      ) : null}
    </span>
  );
}
