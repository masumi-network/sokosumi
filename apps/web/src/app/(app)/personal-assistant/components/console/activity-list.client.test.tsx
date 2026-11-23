import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";

import { createFormats } from "@/i18n/time-format";
import type { ChatDecision, ChatTurn } from "@/lib/soko-bot/chat-state";
import deMessages from "@/messages/de.json";
import messages from "@/messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";

import { ActivityList } from "./activity-list.client";

const prompt = "New mail arrived that Jev triaged as urgent.";

function turn(overrides: Partial<ChatTurn>): ChatTurn {
  return {
    id: "turn-1",
    source: "CHAT",
    status: "COMPLETED",
    route: "DIRECT_RESPONSE",
    userMessage: prompt,
    finalAnswer: "Nothing new worth flagging.",
    errorKind: null,
    errorDetail: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    events: [],
    delegations: [],
    decisions: [],
    requestedBy: null,
    chatRoom: null,
    schedule: null,
    qualityScore: null,
    ...overrides,
  };
}

function renderList(turns: ChatTurn[], locale: "en" | "de" = "en") {
  render(
    <TestQueryProvider>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "de" ? deMessages : messages}
        formats={createFormats()}
        timeZone="UTC"
      >
        <ActivityList
          turns={turns}
          focusTurnId={null}
          userImageUrl={null}
          userName={null}
          onDecisionResolved={() => {}}
        />
      </NextIntlClientProvider>
    </TestQueryProvider>,
  );
}

function rowButton(name: RegExp) {
  return screen.getByRole("button", { name });
}

it.each([
  [{ source: "INGEST" }, /^Mail check · Done/],
  [
    {
      source: "SCHEDULE",
      schedule: { name: "Dreaming", systemKey: "dreaming" },
    },
    /^Dreaming · Done/,
  ],
  // A run whose schedule was deleted, or one from before Core named it.
  [{ source: "SCHEDULE" }, /^Scheduled run · Done/],
  [{ source: "EVENT" }, /^Work update · Done/],
  [{ source: "ADMIN_RETRY" }, /^Retry · Done/],
  [{ source: "SOMETHING_NEW" as ChatTurn["source"] }, /^Run · Done/],
] satisfies [Partial<ChatTurn>, RegExp][])(
  "titles a %o run by what it was, never by its prompt",
  (overrides, title) => {
    renderList([turn(overrides)]);

    expect(rowButton(title)).toBeInTheDocument();
    expect(screen.queryByText(prompt)).not.toBeInTheDocument();
  },
);

it("titles a chat turn with what the person asked", () => {
  renderList([turn({ userMessage: "Book a  table\nfor two" })]);

  expect(rowButton(/^Book a table for two · Done/)).toBeInTheDocument();
});

it.each([
  ["FAILED", "Didn't finish"],
  ["CANCELLED", "Cancelled"],
  ["RUNNING", "Running"],
] as const)("says a %s run's outcome", (status, outcome) => {
  renderList([turn({ source: "INGEST", status })]);

  expect(rowButton(new RegExp(`^Mail check · ${outcome}`))).toBeInTheDocument();
});

const decision = (id: string, status: ChatDecision["status"]) =>
  ({ id, status }) as ChatDecision;

it("marks a run with approvals still waiting", () => {
  renderList([
    turn({
      id: "waiting",
      source: "INGEST",
      decisions: [decision("a", "PENDING"), decision("b", "PENDING")],
    }),
    turn({
      id: "resolved",
      source: "EVENT",
      decisions: [decision("c", "ACCEPTED")],
    }),
  ]);

  expect(
    rowButton(/^Mail check · Done.*2 waiting for approval/),
  ).toBeInTheDocument();
  expect(rowButton(/^Work update/)).not.toHaveTextContent(/approval/i);
});

// The list renders for a shared bot's members too, and Core lets only an
// owner or admin (or the member who asked) answer. The row carries no viewer
// permission, so the mark says the run waits, never that the viewer must act.
it("tells a viewer who cannot approve that a run waits, not that it needs them", () => {
  renderList([
    turn({
      source: "SCHEDULE",
      schedule: { name: "Daily stand-up", systemKey: "standup" },
      decisions: [decision("a", "PENDING")],
    }),
  ]);

  const row = rowButton(/^Daily stand-up · Done/);
  expect(row).toHaveTextContent("Waiting for approval");
  expect(row).not.toHaveTextContent(/needs? you/i);
});

// Structure only: happy-dom does no layout, so this cannot prove wrapping or
// bounds. It fails if the outcome or the approval mark moves back inside the
// name's ellipsis. Rendered bounds at 375 and 320 are checked on the preview.
it("keeps the status and approval mark outside a long name's ellipsis", () => {
  const name = "Evening: merged pull requests with a long roundup graphic";
  renderList([
    turn({
      source: "SCHEDULE",
      schedule: { name, systemKey: null },
      decisions: [decision("a", "PENDING")],
    }),
  ]);

  expect(screen.getByText(name)).toHaveClass("truncate");
  expect(screen.getByText(/· Done/).closest(".truncate")).toBeNull();
  expect(
    screen.getByText("Waiting for approval").closest(".truncate"),
  ).toBeNull();
});

// Structure only, as above. A long translated outcome next to a long name must
// be allowed to break inside the ~94px column of a 320px phone, so it carries
// no no-wrap rule, and the name still reads with its separator.
it("lets a long translated outcome wrap and keeps the separator in the name", () => {
  const name = "Abend: zusammengeführte Pull Requests mit Grafik";
  renderList(
    [
      turn({
        source: "SCHEDULE",
        status: "FAILED",
        schedule: { name, systemKey: null },
        decisions: [decision("a", "PENDING")],
      }),
    ],
    "de",
  );

  const row = rowButton(new RegExp(`^${name} · Nicht beendet`));
  expect(row).toHaveTextContent("Wartet auf Freigabe");
  const outcome = screen.getByText(/· Nicht beendet/);
  expect(outcome.closest(".truncate")).toBeNull();
  expect(outcome.className).not.toMatch(/whitespace-(pre|nowrap)/);
  expect(outcome).toHaveClass("max-w-full");
});
