export type SokoBotIntegrationKind = "email" | "calendar";

export interface SokoBotIntegrationProvider {
  id: "google" | "microsoft";
  name: string;
  kinds: readonly SokoBotIntegrationKind[];
  scopes: {
    email: readonly string[];
    calendar: readonly string[];
  };
}

export const SOKO_BOT_INTEGRATION_PROVIDERS: readonly SokoBotIntegrationProvider[] =
  [
    {
      id: "google",
      name: "Google",
      kinds: ["email", "calendar"],
      scopes: {
        email: ["https://www.googleapis.com/auth/gmail.readonly"],
        calendar: ["https://www.googleapis.com/auth/calendar.readonly"],
      },
    },
    {
      id: "microsoft",
      name: "Microsoft",
      kinds: ["email", "calendar"],
      scopes: {
        email: ["Mail.Read"],
        calendar: ["Calendars.Read"],
      },
    },
  ];

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
