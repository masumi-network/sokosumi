import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { seoTestWorkspace } from "./seo-test-fixture";
import { SeoTimeline } from "./seo-timeline";

describe("SEO timeline recovery", () => {
  it("shows a failed check and offers a reviewed new check without hiding its source Task", () => {
    const workspace = seoTestWorkspace();
    workspace.timeline = [
      {
        id: "failed-check",
        kind: "check",
        title: "SEO analysis requested",
        status: "failed",
        detail: "The requested scope is frozen for this analysis.",
        at: new Date("2026-11-05T12:00:00Z"),
        pageIds: workspace.scope.pageIds,
        taskId: "source-task",
        observationId: null,
      },
    ];
    const retry = vi.fn();
    const view = render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoTimeline workspace={workspace} onRetry={retry} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Failed")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open task" })).toHaveAttribute(
      "href",
      "/tasks/source-task",
    );
    fireEvent.click(screen.getByRole("button", { name: "Run a new check" }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoTimeline workspace={workspace} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Failed")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Run a new check" }),
    ).toBeNull();
  });
});
