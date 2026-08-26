/**
 * External accounts a Soko Bot can connect through Composio. Tool slugs are
 * Composio's; if a slug changes upstream this is the only place to fix it.
 */
export type SokoBotIntegrationKind = "email" | "calendar";

export interface SokoBotIntegrationProvider {
  /** Stable id stored on the integration row; equals the Composio toolkit slug. */
  id: string;
  name: string;
  /** What the bot ingests from it. */
  kinds: readonly SokoBotIntegrationKind[];
  /** Composio tool slugs per operation. */
  tools: {
    listMessages?: string;
    getMessage?: string;
    listEvents?: string;
  };
}

export const SOKO_BOT_INTEGRATION_PROVIDERS: readonly SokoBotIntegrationProvider[] =
  [
    {
      id: "gmail",
      name: "Gmail",
      kinds: ["email"],
      tools: {
        listMessages: "GMAIL_FETCH_EMAILS",
        getMessage: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      },
    },
    {
      id: "googlecalendar",
      name: "Google Calendar",
      kinds: ["calendar"],
      tools: { listEvents: "GOOGLECALENDAR_EVENTS_LIST" },
    },
    {
      id: "outlook",
      name: "Outlook",
      kinds: ["email", "calendar"],
      tools: {
        listMessages: "OUTLOOK_OUTLOOK_LIST_MESSAGES",
        getMessage: "OUTLOOK_OUTLOOK_GET_MESSAGE",
        listEvents: "OUTLOOK_OUTLOOK_CALENDAR_LIST_EVENTS",
      },
    },
  ];

/** Toolkits whose mail is ingested and read through the dedicated inbox tools only. */
export function isSokoBotEmailProvider(id: string): boolean {
  return getSokoBotIntegrationProvider(id)?.kinds.includes("email") ?? false;
}

export function getSokoBotIntegrationProvider(
  id: string,
): SokoBotIntegrationProvider | null {
  return (
    SOKO_BOT_INTEGRATION_PROVIDERS.find((provider) => provider.id === id) ??
    null
  );
}

/** Normalised shapes the bot and the ingest packet work with. */
export interface SokoBotInboxMessage {
  provider: string;
  id: string;
  threadId: string | null;
  from: string;
  to: string[];
  subject: string;
  /** Short plain-text preview. */
  snippet: string;
  receivedAt: string;
  unread: boolean;
  labels: string[];
}

export interface SokoBotInboxMessageDetail extends SokoBotInboxMessage {
  body: string;
}

export interface SokoBotCalendarEvent {
  provider: string;
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  attendees: string[];
  organizer: string | null;
  description: string | null;
  link: string | null;
}
