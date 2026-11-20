import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import messages from "../../../../../messages/en.json";
import { SeoAuditResearch } from "./seo-audit-research";
import { seoTestObservation, seoTestWorkspace } from "./seo-test-fixture";

it("displays lab timings and checks beside a separate real-user gap on the Actions tab", () => {
  const workspace = seoTestWorkspace(),
    url = "https://example.test/guide";
  workspace.observations = [
    {
      ...seoTestObservation(workspace),
      kind: "audit_full",
      pageSpeed: [
        {
          pageUrl: url,
          testedUrl: url,
          device: "mobile",
          field: { status: "no_data" },
          lab: {
            status: "measured",
            median: { lcp: 7400, fcp: 1200, tbt: 180, cls: 0, si: 3600 },
            runs: 1,
            ok: 1,
            lighthouse: "13.6.0",
            pageSpeed: {
              scores: { performance: 72, accessibility: 97 },
              insights: [
                {
                  id: "unused-javascript",
                  title: "Unused JavaScript",
                  detail: "108 KiB could be saved.",
                  action: "Check the bundle.",
                },
              ],
            },
          },
        },
        {
          pageUrl: url,
          testedUrl: url,
          device: "desktop",
          field: { status: "not_checked" },
          lab: { status: "quota" },
        },
      ],
    },
  ];
  render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <SeoResultMessagesProvider messages={messages.App.Seo}>
        <SeoAuditResearch workspace={workspace} />
      </SeoResultMessagesProvider>
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("Mobile LCP 7.4 s")).toBeVisible();
  fireEvent.click(
    screen.getByText("Page speed", { selector: "summary span > span" }),
  );
  const panel = within(screen.getByRole("region", { name: "Page speed" }));
  expect(panel.getByText("Mobile · LCP 7.4 s")).toBeVisible();
  expect(panel.getByText("Over the 2.5 s lab target")).toBeVisible();
  fireEvent.click(panel.getByText("Mobile · LCP 7.4 s"));
  fireEvent.click(panel.getByText("Unused JavaScript"));
  fireEvent.click(panel.getByText(messages.App.Seo.pageSpeed.scores));
  expect(panel.getByText("108 KiB could be saved.")).toBeVisible();
  expect(panel.getByText("Check the bundle.")).toBeVisible();
  expect(panel.getByText("72")).toBeVisible();
  expect(
    panel.getByText("Google reported no real-user data for this URL."),
  ).toBeVisible();
  expect(
    panel.getByText("Desktop · Google’s PageSpeed quota was exhausted."),
  ).toBeVisible();
});

it("counts pages without calling an unmeasured URL tested", () => {
  const workspace = seoTestWorkspace();
  const pageUrl = workspace.pages[0].url;
  workspace.observations = [
    {
      ...seoTestObservation(workspace),
      kind: "audit_full",
      pageSpeed: [
        {
          pageUrl,
          testedUrl: pageUrl,
          device: "mobile",
          field: { status: "not_checked" },
          lab: { status: "not_checked" },
        },
      ],
    },
  ];
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoAuditResearch workspace={workspace} />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByText("1 page", { selector: "summary span" }),
  ).toBeVisible();
});
