import { describe, expect, it } from "vitest";
import { readAnswerResponse } from "./read-answer-response";

const QUESTION =
  "Which of my open tasks have not moved for more than a week, and who has each one?";
const READ_AT = new Date("2026-11-14T13:00:00Z");

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "01a1da2c-f827-7122-9a10-25897248360f",
    name: "Launch QA",
    owner: "your owner",
    status: "DRAFT",
    updatedAt: "2026-11-14T12:00:00Z",
    assignee: { kind: "member", name: "Robin Keller" },
    ...overrides,
  };
}

function read(overrides: Record<string, unknown> = {}) {
  return {
    capability: "list_tasks",
    status: "COMPLETED",
    input: { state: "open", limit: 25 },
    createdAt: READ_AT,
    result: { tasks: [task()], total: 1 },
    ...overrides,
  };
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    source: "CHAT",
    route: "DIRECT_RESPONSE",
    userMessage: QUESTION,
    contextSnapshot: {
      packet: {
        trigger: {
          source: "CHAT",
          route: "DIRECT_RESPONSE",
          askedBy: { kind: "OWNER" },
        },
      },
    },
    toolCalls: [read()],
    ...overrides,
  };
}

describe("readAnswerResponse idle board", () => {
  it("answers no qualifying Tasks from a complete read instead of an action-status stub", () => {
    expect(readAnswerResponse(source())).toBe(
      "None of your open Tasks has been idle for more than 1 week.",
    );
  });

  it("uses exact update times and reports only the owner's qualifying Tasks with their assignees", () => {
    const answer = readAnswerResponse(
      source({
        toolCalls: [
          read({
            result: {
              tasks: [
                task({
                  updatedAt: "2026-11-07T12:59:59Z",
                  assignee: { name: "Hannah Weber" },
                }),
                task({
                  id: "01a1da2c-f65d-743f-9b5d-bd6bbac5955b",
                  name: "Exactly seven days",
                  updatedAt: "2026-11-07T13:00:00Z",
                }),
                task({
                  id: "01a1da2c-f531-7789-bedf-0ff83a6c59a4",
                  name: "Someone else's Task",
                  owner: "Alex",
                  updatedAt: "2026-10-01T13:00:00Z",
                }),
              ],
              total: 3,
            },
          }),
        ],
      }),
    );
    expect(answer).toContain("1 of your open Tasks");
    expect(answer).toContain(
      "[Launch QA](/tasks/01a1da2c-f827-7122-9a10-25897248360f)",
    );
    expect(answer).toContain('assigned to "Hannah Weber"');
    expect(answer).not.toContain("Exactly seven");
    expect(answer).not.toContain("Someone else's");
  });

  it.each([
    ["Which open tasks have been idle for over 2 days?", "2 days"],
    [
      "Which of our open tasks have been inactive for more than 3 weeks?",
      "3 weeks",
    ],
  ])("reads the requested period from %s", (userMessage, period) => {
    expect(readAnswerResponse(source({ userMessage }))).toContain(period);
  });

  it("shows an unassigned qualifying Task without inventing a person", () => {
    expect(
      readAnswerResponse(
        source({
          toolCalls: [
            read({
              result: {
                tasks: [
                  task({ updatedAt: "2026-10-01T00:00:00Z", assignee: null }),
                ],
                total: 1,
              },
            }),
          ],
        }),
      ),
    ).toContain("unassigned");
  });

  it("does not claim absence from a paginated board", () => {
    expect(
      readAnswerResponse(
        source({
          toolCalls: [read({ result: { tasks: [task()], total: 2 } })],
        }),
      ),
    ).toBeNull();
  });

  it.each([
    { state: "open", projectId: "one-project" },
    { state: "open", query: "Launch" },
    { state: "open", idleDays: 8 },
    { state: "finished" },
  ])(
    "does not treat a narrower query as the whole requested board: %j",
    (input) => {
      expect(
        readAnswerResponse(source({ toolCalls: [read({ input })] })),
      ).toBeNull();
    },
  );

  it("accepts a complete read filtered at the requested threshold", () => {
    expect(
      readAnswerResponse(
        source({
          toolCalls: [
            read({
              input: { state: "open", idleDays: 7 },
              result: { tasks: [], total: 0 },
            }),
          ],
        }),
      ),
    ).toBe("None of your open Tasks has been idle for more than 1 week.");
  });

  it.each([
    { source: "SCHEDULE" },
    { route: "MANAGE_WORK" },
    {
      userMessage:
        "Archive the Tasks that have been idle for more than a week.",
    },
    { userMessage: `${QUESTION}\nThen send a reminder.` },
    {
      contextSnapshot: {
        packet: {
          trigger: {
            source: "CHAT",
            route: "DIRECT_RESPONSE",
            askedBy: { kind: "TEAMMATE" },
          },
        },
      },
    },
    { toolCalls: [read({ status: "FAILED" })] },
    { toolCalls: [read({ capability: "get_task_status" })] },
    { toolCalls: [] },
  ])("does not replace unrelated or unauthorized messages: %j", (overrides) => {
    expect(readAnswerResponse(source(overrides))).toBeNull();
  });

  it.each([
    { tasks: [task(), task()], total: 2 },
    { tasks: [task()], total: 1, truncated: true },
    { tasks: [task({ status: "COMPLETED" })], total: 1 },
    { tasks: [task({ updatedAt: "yesterday" })], total: 1 },
    { preview: "clipped board", truncated: true },
  ])("rejects incomplete or malformed board evidence: %j", (result) => {
    expect(
      readAnswerResponse(source({ toolCalls: [read({ result })] })),
    ).toBeNull();
  });

  it("does not expose a stored credential through a Task title", () => {
    const answer = readAnswerResponse(
      source({
        toolCalls: [
          read({
            result: {
              tasks: [
                task({
                  name: "password=synthetic-test-secret-only",
                  updatedAt: "2026-10-01T00:00:00Z",
                }),
              ],
              total: 1,
            },
          }),
        ],
      }),
    );
    expect(answer).toContain("Last update");
    expect(answer).not.toContain("synthetic-test-secret-only");
  });
});
