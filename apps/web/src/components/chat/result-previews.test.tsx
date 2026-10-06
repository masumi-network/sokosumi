import type { ChatResultAvailable } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResultPreviewCard } from "./result-previews";

vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign((key: string) => key, { has: () => true }),
  useFormatter: () => ({
    number: (value: number) => String(value),
    dateTime: (date: Date, _name?: string, options?: { timeZone?: string }) =>
      `${date.toISOString()} ${options?.timeZone ?? ""}`,
  }),
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
