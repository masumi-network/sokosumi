import type { ChatResultAvailable } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResultPreviewCard, ResultPreviews } from "./result-previews";

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
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}));
vi.mock("@/app/personal-assistant/components/chat/decision-card", () => ({
  DecisionCard: () => <div>decision controls</div>,
}));
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
    "uses the existing %s post preview with its account and protected media",
    (provider) => {
      const html = renderToStaticMarkup(
        <ResultPreviewCard
          result={{
            ...task,
            kind: "social_post",
            status: "SCHEDULED",
            summary: "Our launch",
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
      expect(html).toContain('data-testid="social-post-status-SCHEDULED"');
      expect(html.toLowerCase()).toContain("sokosumi");
      expect(html).toContain("Our launch");
      expect(html).toContain('src="/api/drive/files/file/content"');
    },
  );
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
