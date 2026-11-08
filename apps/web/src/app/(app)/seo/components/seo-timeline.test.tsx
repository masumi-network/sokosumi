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
    expect(screen.getByText(/12 rules checked/)).toBeVisible();
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

  it("lists check times newest first and distinguishes a compatible recheck from its save date", () => {
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
      detail: "12 checks run. 2 skipped. 0 failed.",
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
    const graph = screen.getByRole("list", {
      name: "SEO activity, newest first",
    });
    const [recheck, check] = within(graph).getAllByRole("listitem");
    expect(within(recheck).getByText("Recheck results")).toBeVisible();
    expect(within(check).getByText("Check results")).toBeVisible();
    expect(recheck.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-11-02T10:00:00.000Z",
    );
    expect(check.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-11-01T10:00:00.000Z",
    );
    expect(
      within(recheck).getByText("Saved").closest("div")?.querySelector("time"),
    ).toHaveAttribute("datetime", "2026-11-03T12:00:00.000Z");
    expect(
      within(recheck).getByRole("link", { name: "Open task" }),
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

  it("moves focus to the first revealed event when showing all", () => {
    const workspace = seoTestWorkspace();
    workspace.timeline = Array.from({ length: 6 }, (_, index) => ({
      id: `scope-${index}`,
      kind: "scope",
      title: "Page selection changed",
      status: "recorded",
      detail: "",
      at: new Date(Date.UTC(2026, 10, index + 1)),
      pageIds: workspace.scope.pageIds,
      taskId: null,
      observationId: null,
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
    const list = screen.getByRole("list", {
      name: "SEO activity, newest first",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 6 events" }));
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(items[5]).toHaveFocus();
  });

  it("leaves routine syncs out and keeps open failures as one row", () => {
    const workspace = seoTestWorkspace();
    const sync = (id: string, status: string, day: number) => ({
      id,
      kind: "metrics" as const,
      title: "Search Console statistics synced",
      status,
      detail: "",
      at: new Date(Date.UTC(2026, 10, day)),
      pageIds: workspace.scope.pageIds,
      taskId: null,
      observationId: id,
    });
    // Search Console always reports "partial"; its usual filtering notes make it routine.
    workspace.metrics = [
      {
        id: "ok:clicks",
        key: "clicks",
        label: "Search clicks",
        unit: "count",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        value: 2,
        from: "2026-10-01",
        to: "2026-10-28",
        timeZone: "UTC",
        observedAt: new Date(Date.UTC(2026, 10, 2)),
        coverage: "partial",
        points: [],
        notes: [
          "Search Console final data can omit recent dates and privacy-filtered observations.",
        ],
      },
    ];
    workspace.timeline = [
      sync("old-failure", "unavailable", 1),
      sync("ok", "partial", 2),
      sync("failed-1", "unavailable", 3),
      sync("failed-2", "unavailable", 4),
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
    const list = screen.getByRole("list", {
      name: "SEO activity, newest first",
    });
    // The success on day 2 recovered the failure before it, and is itself routine.
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Statistics sync failed 2 times")).toBeVisible();
  });
});
