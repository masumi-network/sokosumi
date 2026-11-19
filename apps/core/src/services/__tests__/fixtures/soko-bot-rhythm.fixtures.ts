export const bot = {
  id: "bot-1",
  userId: "user-1",
  workspaceId: "ws-1",
  ingestTimezone: "UTC",
};
export const gmail = { provider: { id: "gmail" } };

export function event(overrides: Record<string, unknown>) {
  return {
    provider: "googlecalendar",
    id: "ev-1",
    title: "Intro call",
    startsAt: "2026-10-01T10:40:00.000Z",
    endsAt: null,
    allDay: false,
    location: null,
    attendees: ["patrick@nmkr.io", "anna@acme.com"],
    organizer: null,
    description: null,
    link: null,
    raw: {},
    ...overrides,
  };
}

export function message(overrides: Record<string, unknown>) {
  return {
    provider: "gmail",
    id: "m-1",
    threadId: "t-1",
    from: "Anna <anna@acme.com>",
    to: ["patrick@nmkr.io"],
    subject: "Can we meet?",
    snippet: "Does Thursday work?",
    receivedAt: "2026-09-25T09:00:00.000Z",
    unread: true,
    labels: [],
    ...overrides,
  };
}
