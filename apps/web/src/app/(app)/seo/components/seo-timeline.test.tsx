import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { seoTestWorkspace } from "./seo-test-fixture";
import { SeoTimeline } from "./seo-timeline";

describe("SEO timeline recovery", () => {
  it("labels unrequested analysis modules separately from recorded checks", () => {
    const workspace = seoTestWorkspace();
    const observation = {
      id: "html",
      kind: "page_check",
      source: "agent",
      observedAt: new Date("2026-11-01T10:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 0,
      sourceTaskId: null,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const],
      rulebookVersion: "test",
      artifactHash: "hash",
      coverage: {
        checked: 12,
        skipped: 0,
        failed: 0,
        modules: { notRequested: 2, failed: 0 },
      },
    };
    workspace.observations = [observation];
    workspace.timeline = [
      {
        id: "html",
        kind: "check",
        title: "SEO check results imported",
        status: "completed",
        detail: "",
        at: observation.observedAt,
        pageIds: observation.pageIds,
        taskId: null,
        observationId: observation.id,
      },
    ];
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoTimeline workspace={workspace} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("12 checks recorded")).toBeVisible();
    expect(
      screen.getByText("Analysis types: 2 not requested, 0 unavailable"),
    ).toBeVisible();
    expect(
      screen.queryByText("Some requested work could not be completed."),
    ).toBeNull();
  });

  it.each([
    ["READY", "Ready"],
    ["INPUT_REQUIRED", "Input required"],
    ["CANCELED", "Canceled"],
  ])(
    "shows current action Task status %s without inventing a completion event",
    (status, label) => {
      const workspace = seoTestWorkspace();
      workspace.timeline = [
        {
          id: "action-link",
          kind: "action",
          title: "Recommendation linked to a Task",
          detail: "Task completion records implementation.",
          at: new Date("2026-11-02T10:00:00Z"),
          pageIds: workspace.scope.pageIds,
          observationId: null,
          taskId: "action-task",
          status,
        },
      ];
      render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          formats={createFormats()}
          messages={messages}
        >
          <SeoTimeline workspace={workspace} />
        </NextIntlClientProvider>,
      );
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.getByText("Action Task linked")).toBeVisible();
    },
  );

  it("graphs check times in order and distinguishes a compatible recheck from its save date", () => {
    const workspace = seoTestWorkspace();
    const first = {
      id: "first",
      kind: "page_check",
      source: "agent",
      observedAt: new Date("2026-11-01T10:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "first-task",
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const],
      rulebookVersion: "test-rules",
      artifactHash: "first-hash",
      coverage: { checked: 12, skipped: 2, failed: 0 },
    };
    workspace.observations = [
      first,
      {
        ...first,
        id: "second",
        sourceTaskId: "second-task",
        observedAt: new Date("2026-11-02T10:00:00Z"),
      },
    ];
    workspace.timeline = workspace.observations.map((observation) => ({
      id: observation.id,
      kind: "check",
      title: "SEO check results imported",
      status: "completed",
      detail: "12 checks recorded. 2 skipped. 0 failed.",
      at: new Date(
        observation.id === "first"
          ? "2026-11-04T12:00:00Z"
          : "2026-11-03T12:00:00Z",
      ),
      pageIds: observation.pageIds,
      taskId: observation.sourceTaskId,
      observationId: observation.id,
    }));
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoTimeline workspace={workspace} />
      </NextIntlClientProvider>,
    );
    const graph = screen.getByRole("list", { name: "SEO activity graph" });
    const events = within(graph).getAllByRole("listitem");
    expect(within(events[0]).getByText("Check results")).toBeVisible();
    expect(within(events[1]).getByText("Recheck results")).toBeVisible();
    expect(events[0].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-11-01T10:00:00.000Z",
    );
    expect(events[1].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-11-02T10:00:00.000Z",
    );
    expect(
      within(events[1])
        .getByText("Saved")
        .closest("div")
        ?.querySelector("time"),
    ).toHaveAttribute("datetime", "2026-11-03T12:00:00.000Z");
    expect(
      within(events[1]).getByRole("link", { name: "Open task" }),
    ).toHaveAttribute("href", "/tasks/second-task");
  });

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
