import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoSiteSpeed } from "./seo-site-speed";
import {
  seoTestSpeedDevice,
  seoTestSpeedField,
  seoTestWorkspace,
} from "./seo-test-fixture";

it("names a page's speed in words and opens its measurements", () => {
  const workspace = seoTestWorkspace();
  const url = "https://example.com/pricing";
  workspace.siteSpeed = {
    rows: [
      {
        url,
        audited: false,
        cause: "keyword",
        why: "It ranks for “battery app”.",
        tier: "reduced",
        devices: [
          seoTestSpeedDevice({
            pageUrl: url,
            testedUrl: url,
            field: seoTestSpeedField({ lcp: 3100, cls: 0.05 }, "origin"),
          }),
        ],
      },
    ],
    dropped: 0,
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    observedAt: new Date("2026-11-11T00:26:00Z"),
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSiteSpeed workspace={workspace} />
    </NextIntlClientProvider>,
  );
  const row = within(screen.getByRole("row", { name: /pricing/ }));
  expect(row.getByText("Over a limit: loading (LCP)")).toBeVisible();
  expect(row.getByText("Real visitors, whole site")).toBeVisible();
  const toggle = row.getByRole("button", { name: "/pricing" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const detail = document.getElementById(
    toggle.getAttribute("aria-controls") ?? "",
  );
  expect(detail).not.toBeNull();
  const opened = within(detail as HTMLElement);
  // Core's sentence stands alone: the cause label would say it twice.
  expect(opened.getByText("It ranks for “battery app”.")).toBeVisible();
  expect(
    opened.queryByText(messages.App.Seo.siteSpeed.cause.keyword),
  ).toBeNull();
  fireEvent.click(opened.getByText(/^Mobile · Real visitors, whole site/));
  expect(opened.getByText("Too little data")).toBeVisible();
  expect(
    opened.getByText(messages.App.Seo.pageSpeed.caveat.origin),
  ).toBeVisible();
});
