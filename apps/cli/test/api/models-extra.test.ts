import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCoworker,
  parseCoworkerApiKey,
} from "../../src/api/models/coworker.js";
import { parseJobEvent } from "../../src/api/models/job-event.js";
import { parseJobFile, parseJobLink } from "../../src/api/models/job-output.js";
import { parseTask } from "../../src/api/models/task.js";

test("new Core models tolerate unexpected values with sibling defaults", () => {
  const emptyCoworker = {
    id: null,
    createdAt: null,
    updatedAt: null,
    archivedAt: null,
    priority: 0,
    slug: null,
    name: null,
    vendor: null,
    caption: null,
    url: null,
    baseURL: null,
    description: null,
    image: null,
    metadata: null,
    isWhitelisted: false,
    capabilities: [],
  };
  assert.deepEqual(parseCoworker(null), emptyCoworker);
  assert.deepEqual(
    parseCoworker({
      id: "cow-1",
      company: "Acme",
      companyLogo: "https://logo",
      email: "ops@acme.test",
      status: "ONLINE",
      isNew: true,
      isShown: true,
      price: { credits: 9, includedFee: 1 },
      estimatedDuration: 12,
    }),
    { ...emptyCoworker, id: "cow-1" },
  );
  assert.equal(parseTask(null).jobs.length, 0);
  assert.deepEqual(parseJobEvent(null), {
    id: null,
    createdAt: null,
    status: null,
    result: null,
  });
  assert.equal(parseJobFile(null).url, null);
  assert.equal(parseJobLink(null).url, null);
  assert.equal(parseCoworkerApiKey(null).token, null);
});

test("parseTask maps live Core Task fields onto CLI names", () => {
  assert.deepEqual(
    parseTask({
      id: "tsk-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      ownerId: "user-1",
      userId: "ignored-user",
      organizationId: "org-1",
      name: "Review onboarding",
      description: "Notes",
      status: "READY",
      assigneeId: "cow-1",
      coworkerId: "ignored-coworker",
      assignee: {
        type: "coworker",
        id: "cow-1",
        coworker: { id: "cow-1", name: "Ops Agent", slug: "ops-agent" },
      },
      coworkerName: "ignored-name",
      credits: 5,
      totalCredits: 99,
      jobs: [{ id: "job-1", agentId: "agent-1" }],
      events: [{ id: "evt-1" }],
    }),
    {
      id: "tsk-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      userId: "user-1",
      organizationId: "org-1",
      name: "Review onboarding",
      description: "Notes",
      status: "READY",
      coworkerId: "cow-1",
      coworkerName: "Ops Agent",
      jobs: [
        {
          id: "job-1",
          agentId: "agent-1",
          status: null,
          name: null,
          result: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      totalCredits: 5,
      events: [{ id: "evt-1" }],
    },
  );
  assert.equal(
    parseTask({ assignee: { type: "user", id: "user-1" } }).coworkerName,
    null,
  );
});

test("preserves Core job event status and result", () => {
  assert.deepEqual(
    parseJobEvent({
      id: "event-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      status: "AWAITING_INPUT",
      inputSchema: '{"type":"object"}',
      input: null,
      result: "Please provide the missing value.",
      files: [],
      links: [],
      jobId: "job-123",
      type: "update",
      message: "ignored leftover",
      data: { extra: true },
    }),
    {
      id: "event-123",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "AWAITING_INPUT",
      result: "Please provide the missing value.",
    },
  );
});

test("job file parser prefers fileUrl and falls back to sourceUrl", () => {
  assert.equal(
    parseJobFile({
      fileUrl: "https://blob/file",
      sourceUrl: "https://source/file",
    }).url,
    "https://blob/file",
  );
  assert.equal(
    parseJobFile({ sourceUrl: "https://source/file" }).url,
    "https://source/file",
  );
});
