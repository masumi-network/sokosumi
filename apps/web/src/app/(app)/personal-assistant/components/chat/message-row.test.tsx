import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";

import { createFormats } from "@/i18n/time-format";
import type { ChatTurn } from "@/lib/soko-bot/chat-state";
import messages from "@/messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";

import { TurnRows } from "./message-row";

const providerDetail =
  "Unable to submit request because Thinking_config.include_thoughts is only enabled when thinking is enabled";

it.each([
  [
    "GatewayInternalServerError",
    "Something went wrong on our side. Try again. If it keeps happening, contact support.",
  ],
  [
    "ai_budget_exceeded",
    "Your assistant has reached its usage limit. It can respond again when the limit is raised or resets.",
  ],
])("shows owner-safe copy for a failed %s turn", (errorKind, expected) => {
  const turn: ChatTurn = {
    id: "turn-1",
    source: "CHAT",
    status: "FAILED",
    route: "DIRECT_RESPONSE",
    userMessage: "Can you help?",
    finalAnswer: null,
    errorKind,
    errorDetail: providerDetail,
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
  };

  render(
    <TestQueryProvider>
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        formats={createFormats()}
        timeZone="UTC"
      >
        <TurnRows turn={turn} onDecisionResolved={() => {}} />
      </NextIntlClientProvider>
    </TestQueryProvider>,
  );

  expect(screen.queryByText(providerDetail)).not.toBeInTheDocument();
  expect(screen.getByText(expected)).toBeInTheDocument();
});
