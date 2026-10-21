import type { ChatResultAvailable } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { cardHref, ResultPreviewCard, ResultPreviews } from "./result-previews";

const { resultQuery } = vi.hoisted(() => ({ resultQuery: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: resultQuery }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { user: { id: "owner" }, session: {} } }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTimeZone: () => "UTC",
  useTranslations: () =>
    Object.assign(
      (key: string, values?: { title?: string; name?: string }) =>
        key === "openLabel"
          ? `Open source: ${values?.title}`
          : key === "downloadLabel"
            ? `Download ${values?.name}`
            : key,
      { has: () => true },
    ),
  useFormatter: () => ({
    number: (value: number) => String(value),
    dateTime: (date: Date, _name?: string, options?: { timeZone?: string }) =>
      `${date.toISOString()} ${options?.timeZone ?? ""}`,
    relativeTime: (date: Date) => date.toISOString(),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}));
vi.mock("@/app/personal-assistant/components/chat/decision-card", async () => {
  const { useSokoBotTargetId } = await import(
    "@/app/personal-assistant/components/soko-bot-target"
  );
  return {
    DecisionCard: () => (
      <div>decision controls for {useSokoBotTargetId() ?? "own bot"}</div>
    ),
  };
});
const task: ChatResultAvailable = {
  id: "card",
  state: "available",
  kind: "task",
  title: "Launch campaign",
  status: "INPUT_REQUIRED",
  capturedAt: new Date("2026-10-06T10:00:00Z"),
  sourceHref: "/tasks/task",
  question: "Which audience?",
  scheduledAt: new Date("2026-10-07T09:00:00Z"),
  timezone: "Europe/Prague",
  assignee: "Writer",
  outputs: [],
};
describe("chat result cards", () => {
  it("shows the recorded task, real question, timezone and source link", () => {
    const html = renderToStaticMarkup(
      <ResultPreviewCard result={task} onDecisionResolved={() => {}} />,
    );
    expect(html).toContain("Launch campaign");
    expect(html).toContain("Which audience?");
    expect(html).toContain("Europe/Prague");
    expect(html).toContain('href="/tasks/task"');
    expect(html).toContain("recorded");
  });
  it("shows a hired Agent's Job as status, labelled input and a job link", () => {
    const html = renderToStaticMarkup(
      <ResultPreviewCard
        result={{
          ...task,
          kind: "job",
          title: "Attention insights for nmkr.io",
          status: "payment_pending",
          question: null,
          scheduledAt: null,
          timezone: null,
          assignee: "AttentionInsight",
          agent: { name: "AttentionInsight", icon: null },
          sourceHref: "/agents/agent/jobs/job",
          details: [
            { label: "Website", value: "https://nmkr.io" },
            { label: "Study type", value: "web" },
          ],
        }}
        onDecisionResolved={() => {}}
      />,
    );
    expect(html).toContain("jobHint.payment_pending");
    expect(html).toContain("Website");
    expect(html).toContain('href="https://nmkr.io/"');
    expect(html).toContain(">nmkr.io</a>");
    expect(html).toContain("openJob");
    expect(html).not.toContain("recorded");
    expect(html).not.toContain(">assignee<");
    expect(html).not.toContain("input_url");
  });
  it("names source and download links by their resource", () => {
    const html = renderToStaticMarkup(
      <ResultPreviewCard
        result={{
          ...task,
          kind: "file",
          title: "Campaign brief",
          outputs: [
            {
              name: "brief.docx",
              sizeBytes: null,
              previewHref: null,
              contentType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              openHref: "/drive/file",
              downloadHref: "/drive/file?download=true",
            },
          ],
        }}
        onDecisionResolved={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Open source: Campaign brief"');
    expect(html).toContain('aria-label="Download brief.docx"');
  });
  it.each([
    "task",
    "task_schedule",
    "bot_schedule",
    "social_post",
    "studio_job",
    "job",
    "file",
  ] as const)(
    "provides a full-card source link for %s without nesting output controls",
    (kind) => {
      const html = renderToStaticMarkup(
        <ResultPreviewCard
          result={{
            ...task,
            kind,
            outputs: [
              {
                name: "brief.docx",
                contentType: null,
                sizeBytes: null,
                previewHref: null,
                openHref: "/drive/file",
                downloadHref: "/drive/file?download=true",
              },
            ],
          }}
          onDecisionResolved={() => {}}
        />,
      );
      expect(html).toContain('data-testid="result-preview-source"');
      expect(html).toContain('aria-label="Open source: Launch campaign"');
      expect(html).toContain("absolute inset-0");
      expect(html).toContain('aria-label="Download brief.docx"');
    },
  );
  it("renders the app's TaskCard with real project, assignee and privacy metadata", () => {
    const html = renderToStaticMarkup(
      <ResultPreviewCard
        result={{
          ...task,
          summary: "hello[attachment.svg](https://files.example/long-path)",
          recurrence: "20 7 * * *",
          scheduledAt: new Date("2026-10-07T07:20:00Z"),
          task: {
            id: "task",
            name: "Launch campaign",
            identifier: "SUM-12",
            status: "INPUT_REQUIRED",
            priority: "HIGH",
            visibility: "PRIVATE",
            createdAt: new Date("2026-10-06T10:00:00Z"),
            runAt: null,
            project: {
              id: "summer",
              name: "Summer",
              identifier: "SUM",
              logo: null,
            },
            assignee: {
              id: "writer",
              name: "Hannah",
              image: "/images/coworkers/hannah.webp",
              kind: "coworker",
              avatarSeed: null,
            },
            participants: [],
            commentsCount: 3,
            tags: { manual: ["marketing"], automatic: [], rejected: [] },
          },
        }}
        onDecisionResolved={() => {}}
      />,
    );
    expect(html).toContain("SUM-12");
    expect(html).toContain('aria-label="privateBadge"');
    expect(html).toContain('data-testid="task-actor-face"');
    expect(html).toContain('aria-label="Hannah"');
    expect(html).toContain('href="/projects/summer"');
    expect(html).toContain("vocabulary.marketing");
    expect(html).not.toContain("hello[attachment.svg]");
    expect(html).not.toContain("20 7 * * *");
    expect(html).toContain("max-w-sm");
  });
  it.each(["linkedin", "x", "instagram"] as const)(
    "renders only the existing %s post card with its account and protected media",
    (provider) => {
      const html = renderToStaticMarkup(
        <ResultPreviewCard
          result={{
            ...task,
            kind: "social_post",
            status: "SCHEDULED",
            summary: "Our launch",
            destination: `${provider} · sokosumi`,
            sourceHref: "/social?post=launch",
            social: {
              provider,
              account: {
                displayName: "Sokosumi",
                handle: "sokosumi",
                avatarUrl: "/images/coworkers/elena.webp",
              },
              timestamp: new Date("2026-10-07T10:00:00Z"),
            },
            outputs: [
              {
                name: "launch.png",
                contentType: "image/png",
                sizeBytes: 10,
                openHref: "/drive/files/file",
                previewHref: "/api/drive/files/file/content",
              },
            ],
          }}
          onDecisionResolved={() => {}}
        />,
      );
      expect(html).toContain('data-testid="social-post-preview"');
      expect(html).toContain(`data-provider="${provider}"`);
      expect(html).not.toContain('data-testid="social-post-status-SCHEDULED"');
      expect(html.toLowerCase()).toContain("sokosumi");
      expect(html).toContain("Our launch");
      expect(html).toContain('src="/api/drive/files/file/content"');
      expect(html).not.toContain(`${provider} · sokosumi`);
      expect(html).not.toContain(
        '<dt class="text-muted-foreground">destination</dt>',
      );
      expect(html).not.toContain("recorded");
      expect(html).not.toContain(">open<");
      expect(html).not.toContain("Europe/Prague");
      expect(html).not.toContain("Which audience?");
      expect(html).not.toContain("Writer");
      expect(html).not.toContain("kind.social_post");
      expect(html).not.toContain('data-testid="result-preview-source"');
      expect(html).not.toContain('href="/social?post=launch"');
      expect(html).not.toContain('aria-label="Open source: Launch campaign"');
    },
  );
  it("shows now on a draft social card with no publish time", () => {
    const html = renderToStaticMarkup(
      <ResultPreviewCard
        result={{
          ...task,
          kind: "social_post",
          status: "DRAFT",
          summary: "Our launch",
          capturedAt: new Date("2026-10-06T10:00:00Z"),
          social: {
            provider: "x",
            account: {
              displayName: "Sokosumi",
              handle: "sokosumi",
              avatarUrl: null,
            },
            timestamp: null,
          },
          outputs: [],
        }}
        onDecisionResolved={() => {}}
      />,
    );
    expect(html).toContain("now");
    expect(html).not.toContain("2026-10-06");
  });
  it("renders an unavailable card without a resource link", () => {
    const html = renderToStaticMarkup(
      <ResultPreviewCard
        result={{ id: "card", state: "unavailable" }}
        onDecisionResolved={() => {}}
      />,
    );
    expect(html).toContain("unavailable");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("Launch campaign");
  });
  it("shows every actual output and keeps failed generation details", () => {
    const html = renderToStaticMarkup(
      <ResultPreviewCard
        result={{
          ...task,
          kind: "studio_job",
          status: "FAILED",
          question: null,
          summary: "Provider rejected request",
          outputs: [1, 2].map((i) => ({
            name: `image-${i}`,
            contentType: "image/png",
            sizeBytes: null,
            openHref: "/studio",
            previewHref: `/api/assets/${i}`,
          })),
        }}
        onDecisionResolved={() => {}}
      />,
    );
    expect(html).toContain("Provider rejected request");
    expect(html).toContain('src="/api/assets/1"');
    expect(html).toContain('src="/api/assets/2"');
  });

  it.each([
    ["report.pdf", "application/pdf", 'aria-label="viewDocument"'],
    ["report.txt", "text/plain", 'aria-label="viewDocument"'],
    ["song.mp3", "audio/mpeg", "<audio"],
    ["clip.mp4", "video/mp4", "<video"],
  ])(
    "uses the existing in-chat viewer for %s",
    (name, contentType, expected) => {
      const html = renderToStaticMarkup(
        <ResultPreviewCard
          result={{
            ...task,
            kind: "file",
            outputs: [
              {
                name,
                contentType,
                sizeBytes: null,
                openHref: "/drive/files/file",
                previewHref: "/api/drive/files/file/content",
              },
            ],
          }}
          onDecisionResolved={() => {}}
        />,
      );
      expect(html).toContain(expected);
    },
  );
  it("keeps private Office files out of the external viewer", () => {
    const html = renderToStaticMarkup(
      <ResultPreviewCard
        result={{
          ...task,
          kind: "file",
          outputs: [
            {
              name: "report.docx",
              contentType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              sizeBytes: null,
              openHref: "/drive/files/file",
              previewHref: "/api/drive/files/file/content",
            },
          ],
        }}
        onDecisionResolved={() => {}}
      />,
    );
    expect(html).toContain('href="/drive/files/file"');
    expect(html).not.toContain('aria-label="viewDocument"');
  });
  it("keeps the chat readable when a newer server returns an unknown card kind", () => {
    const future = JSON.parse(
      JSON.stringify({ ...task, kind: "future-result" }),
    );
    const html = renderToStaticMarkup(
      <ResultPreviewCard result={future} onDecisionResolved={() => {}} />,
    );
    expect(html).toContain("unavailable");
    expect(html).not.toContain("Launch campaign");
  });
});

describe("result footer hydration", () => {
  it("passes only the displayed descriptors to the footer", () => {
    resultQuery.mockReturnValue({
      data: [task, { ...task, id: "other" }],
      isFetching: false,
      isError: false,
    });
    const footer = vi.fn(() => <span>footer</span>);
    renderToStaticMarkup(
      <ResultPreviews
        descriptors={[{ id: task.id, capturedAt: task.capturedAt }]}
        source={{ roomId: "room", messageId: "message" }}
        renderFooter={footer}
      />,
    );
    expect(footer).toHaveBeenCalledWith([task]);
  });
  it.each([{ isFetching: true }, { isError: true }])(
    "preserves fallback links when no card can be shown",
    (state) => {
      resultQuery.mockReturnValue({ ...state, data: [task] });
      const footer = vi.fn(() => <span>fallback link</span>);
      const html = renderToStaticMarkup(
        <ResultPreviews
          descriptors={[{ id: task.id, capturedAt: task.capturedAt }]}
          source={{ roomId: "room", messageId: "message" }}
          renderFooter={footer}
        />,
      );
      expect(footer).toHaveBeenCalledWith([]);
      expect(html).toContain("fallback link");
    },
  );
});

describe("decision cards from a shared bot", () => {
  const decision: ChatResultAvailable = {
    ...task,
    id: "decision-card",
    kind: "decision",
    decision: {
      id: "d1",
      turnId: "t1",
      toolName: "hire_agent",
      proposal: {},
      reason: "because",
      status: "PENDING",
      expiresAt: new Date("2026-10-08T09:00:00Z"),
      resolvedAt: null,
      resultingEntityId: null,
      createdAt: new Date("2026-10-06T10:00:00Z"),
      updatedAt: new Date("2026-10-06T10:00:00Z"),
    },
  };

  function render(sokoBotId?: string | null): string {
    resultQuery.mockReturnValue({
      data: [decision],
      isFetching: false,
      isError: false,
    });
    return renderToStaticMarkup(
      <ResultPreviews
        descriptors={[{ id: decision.id, capturedAt: decision.capturedAt }]}
        source={{ roomId: "room", messageId: "message" }}
        sokoBotId={sokoBotId}
      />,
    );
  }

  it("resolves on the shared bot that sent the message", () => {
    expect(render("bot-shared")).toContain("decision controls for bot-shared");
  });

  it("resolves on the caller's own bot otherwise", () => {
    expect(render(null)).toContain("decision controls for own bot");
  });
});

describe("turn results in a shared bot's console", () => {
  /** The URL the last query's fetch reads; a failed response is enough. */
  async function fetchedTurnUrl() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { queryFn } = resultQuery.mock.lastCall?.[0] ?? {};
      await queryFn({ signal: new AbortController().signal }).catch(
        () => undefined,
      );
    } finally {
      vi.unstubAllGlobals();
    }
    return fetchMock.mock.calls[0]?.[0];
  }

  it("reads the turn's results from the bot in context", async () => {
    const { SokoBotTargetContext } = await import(
      "@/app/personal-assistant/components/soko-bot-target"
    );
    resultQuery.mockReturnValue({
      data: [],
      isFetching: false,
      isError: false,
    });
    renderToStaticMarkup(
      <SokoBotTargetContext.Provider value="bot-shared">
        <ResultPreviews
          descriptors={[{ id: task.id, capturedAt: task.capturedAt }]}
          source={{ turnId: "turn-1" }}
        />
      </SokoBotTargetContext.Provider>,
    );
    expect(resultQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining([
          { turnId: "turn-1", botId: "bot-shared" },
        ]),
      }),
    );
    expect(await fetchedTurnUrl()).toBe(
      "/api/personal-assistant/turns/turn-1/results?botId=bot-shared",
    );
  });

  it("reads the caller's own turn outside a shared console", async () => {
    resultQuery.mockReturnValue({
      data: [],
      isFetching: false,
      isError: false,
    });
    renderToStaticMarkup(
      <ResultPreviews
        descriptors={[{ id: task.id, capturedAt: task.capturedAt }]}
        source={{ turnId: "turn-1" }}
      />,
    );
    expect(resultQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining([{ turnId: "turn-1" }]),
      }),
    );
    expect(await fetchedTurnUrl()).toBe(
      "/api/personal-assistant/turns/turn-1/results",
    );
  });
});

describe("bot card links for a shared bot", () => {
  it("sends the caller's console link to the shared bot's console", () => {
    expect(cardHref("/personal-assistant", "bot-1")).toBe("/soko-bots/bot-1");
    expect(cardHref("/personal-assistant?view=advanced", "bot-1")).toBe(
      "/soko-bots/bot-1?view=advanced",
    );
  });

  it("leaves other links and the caller's own bot alone", () => {
    expect(cardHref("/personal-assistant", null)).toBe("/personal-assistant");
    expect(cardHref("/tasks/t1", "bot-1")).toBe("/tasks/t1");
    expect(cardHref("/personal-assistant-x", "bot-1")).toBe(
      "/personal-assistant-x",
    );
  });

  it("links a schedule card in a shared bot's room to its console", async () => {
    const { SokoBotTargetContext } = await import(
      "@/app/personal-assistant/components/soko-bot-target"
    );
    const schedule: ChatResultAvailable = {
      ...task,
      id: "schedule",
      kind: "bot_schedule",
      sourceHref: "/personal-assistant",
    };
    const html = renderToStaticMarkup(
      <SokoBotTargetContext.Provider value="bot-1">
        <ResultPreviewCard result={schedule} onDecisionResolved={() => {}} />
      </SokoBotTargetContext.Provider>,
    );
    expect(html).toContain('href="/soko-bots/bot-1"');
  });
});
