import type {
  ProjectSeoKeyword,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoAnalysisDialog } from "./seo-analysis-dialog";
import { openCheckOptions, seoTestWorkspace } from "./seo-test-fixture";
import { useSeoWorkspace } from "./use-seo-workspace";

const { mutate, toastError } = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));
const clients: QueryClient[] = [];
function savedKeyword(
  keyword: string,
  countryCode: string,
  languageCode: string,
): ProjectSeoKeyword {
  return {
    id: `${countryCode}-${keyword}`,
    keyword,
    countryCode,
    languageCode,
    saved: true,
    pageUrl: null,
    targetPageId: null,
    source: "saved",
    volume: null,
    intent: null,
    difficulty: null,
    clicks: null,
    conversion: null,
    feature: null,
    device: null,
    position: null,
    positionStatus: "unavailable",
    checkedResults: null,
    observedAt: null,
    observationId: null,
    priority: "medium",
    version: 1,
  };
}
function workspace() {
  const data = seoTestWorkspace();
  data.keywords = [
    savedKeyword("Akku Zustand", "DE", "de"),
    savedKeyword("battery health", "US", "en"),
  ];
  data.keywords.push({
    ...data.keywords[0],
    id: "observed-mobile",
    source: "rank_refresh",
    device: "mobile",
    keyword: "AKKU   ZUSTAND",
  });
  return data;
}
function DialogHarness({
  workspace,
  monitor,
}: {
  workspace: ProjectSeoWorkspace;
  monitor?: boolean;
}) {
  return (
    <SeoAnalysisDialog model={useSeoWorkspace(workspace)} monitor={monitor} />
  );
}
function showDialog(data: ProjectSeoWorkspace, monitor = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(data)),
  );
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>
          <DialogHarness workspace={data} monitor={monitor} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return screen.getByRole("dialog");
}
async function selectCountry(
  user: ReturnType<typeof userEvent.setup>,
  country: string,
) {
  await user.click(screen.getByRole("combobox", { name: "Search country" }));
  await user.click(screen.getByRole("option", { name: country }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mutate.mockResolvedValue({ ok: true, value: null });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("SEO check defaults", () => {
  it("opens on a summary of its defaults and starts the full audit with the fields closed", async () => {
    const user = userEvent.setup(),
      dialog = showDialog(workspace());
    const summary = within(dialog).getByTestId("seo-analysis-summary");
    expect(within(summary).getByText("Full audit")).toBeVisible();
    expect(
      within(dialog).getByText(
        messages.App.Seo.analysis.publicLinkScope.replaceAll("{limit}", "10"),
      ),
    ).toBeVisible();
    // One line: the market of the saved keyword, by name, and the one keyword a full audit takes. Both
    // devices are the default and go unsaid.
    expect(summary).toHaveTextContent(
      "Full audit · All pages · Germany · German · Akku Zustand",
    );
    // No field asks for a choice until the reader wants one.
    expect(
      within(dialog).getByRole("button", { name: "Change options" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog).queryByRole("combobox", { name: "Check type" }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Start check" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command.body).toMatchObject({
      kind: "audit_full",
      countryCode: "DE",
      languageCode: "de",
      keywords: ["Akku Zustand"],
      devices: ["mobile", "desktop"],
    });
  });

  it("starts with a public sitemap and only the public page hints reviewed from a local XML file", async () => {
    const user = userEvent.setup();
    const dialog = within(showDialog(workspace()));
    await user.click(dialog.getByRole("button", { name: "Change options" }));
    const base = "https://example.com/";
    const sitemapUrl = base + "public-map.xml";
    await user.type(
      dialog.getByLabelText("Public sitemap URL (optional)"),
      sitemapUrl,
    );
    const xml =
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      [base + "guide", base + "profile/person", "https://away.example/x"]
        .map((url) => `<url><loc>${url}</loc></url>`)
        .join("") +
      "</urlset>";
    await user.upload(
      dialog.getByLabelText("Import a sitemap XML file (optional)"),
      new File([xml], "pages.xml", { type: "application/xml" }),
    );
    expect(await dialog.findByText(base + "guide")).toBeVisible();
    expect(dialog.queryByText(base + "profile/person")).toBeNull();
    await user.click(dialog.getByRole("button", { name: "Start check" }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command.body).toMatchObject({
      kind: "audit_full",
      publicSitemapUrl: sitemapUrl,
      sitemapPageHints: [base + "guide"],
    });
  });

  it("keeps the summary true to a changed field, and shows the fields when a value is refused", async () => {
    const data = workspace();
    data.keywords = [];
    const user = userEvent.setup(),
      dialog = showDialog(data);
    const summary = within(dialog).getByTestId("seo-analysis-summary");
    // No saved keyword and a .com page: the market falls back to US English.
    expect(summary).toHaveTextContent("United States · English");
    expect(summary).not.toHaveTextContent("Mobile");
    const options = within(dialog).getByRole("button", {
      name: "Change options",
    });
    await user.click(options);
    await user.click(within(dialog).getByLabelText("Mobile"));
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    await user.click(options);
    expect(options).toHaveAttribute("aria-expanded", "false");
    expect(within(summary).getByText("Keyword positions")).toBeVisible();
    // One device is a choice, so the line says it.
    expect(summary).toHaveTextContent("United States · English · Desktop");
    // No limit shows, and no keyword means no paid request yet, so no price in credits.
    expect(within(dialog).queryByText(/data requests/)).toBeNull();
    expect(within(dialog).queryByText(/credits/)).toBeNull();
    // Keyword positions need a keyword: the request is not sent, and the fields open on the message.
    await user.click(
      within(dialog).getByRole("button", { name: "Start check" }),
    );
    await waitFor(() =>
      expect(options).toHaveAttribute("aria-expanded", "true"),
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("Search Console audit launch", () => {
  it.each([false, true])(
    "requires explicit limited consent after Core refuses the launch (monitor %s)",
    async (monitor) => {
      mutate.mockResolvedValueOnce({
        ok: false,
        error: {
          kind: "seo_gsc_not_connected",
          status: 409,
          message: "private account diagnostic",
        },
      });
      const user = userEvent.setup();
      const dialog = showDialog(workspace(), monitor);
      await user.click(
        within(dialog).getByRole("button", {
          name: monitor
            ? messages.App.Seo.monitor.create
            : messages.App.Seo.analysis.submit,
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Connect Search Console",
      );
      expect(
        screen.getByRole("dialog", { name: "Search Console coverage" }),
      ).toHaveAccessibleDescription(
        monitor
          ? /Approximately 750 credits per run/
          : /Approximately 750 credits/,
      );
      expect(screen.queryByText(/private account diagnostic/)).toBeNull();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
      expect(mutate).toHaveBeenCalledTimes(1);
      await user.dblClick(
        screen.getByRole("button", {
          name: monitor ? "Schedule limited audits" : "Start limited audit",
        }),
      );
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
      const [initial, limited] = mutate.mock.calls.map(
        ([{ command }]) => command.body,
      );
      const first = monitor ? initial.analysis : initial;
      const next = monitor ? limited.analysis : limited;
      expect(first.includePropertyTotals).toBe(true);
      expect(next.includePropertyTotals).toBeUndefined();
      expect(first.includeSitemaps).toBe(true);
      expect(next.includeSitemaps).toBeUndefined();
      expect(first.allowLimitedAudit).toBeUndefined();
      expect(next).toMatchObject({
        idempotencyKey: first.idempotencyKey,
        allowLimitedAudit: true,
      });
      if (monitor) expect(limited.operationId).toBe(initial.operationId);
    },
  );
});

describe("uncertain audit launches", () => {
  it("resolves the original request without authorizing an edited audit", async () => {
    let finish!: () => void;
    mutate.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      throw new Error("Response lost");
    });
    mutate.mockResolvedValueOnce({
      ok: false,
      error: { kind: "seo_gsc_property", status: 409 },
    });
    const user = userEvent.setup();
    const dialog = showDialog(workspace());
    const start = within(dialog).getByRole("button", { name: "Start check" });
    await user.click(start);
    await act(async () => finish());
    await openCheckOptions(user);
    await selectCountry(user, "US");
    await user.click(start);
    expect(mutate).toHaveBeenCalledTimes(1);
    const retry = toastError.mock.lastCall?.[1]?.action;
    expect(retry?.label).toBe(messages.App.Seo.analysis.retryPrevious);
    await act(async () => retry.onClick());
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
    expect(
      screen.queryByRole("button", { name: "Start limited audit" }),
    ).toBeNull();
    expect(toastError).toHaveBeenCalledWith(
      messages.App.Seo.analysis.coverage.property,
    );
    await act(async () => retry.onClick());
    expect(mutate).toHaveBeenCalledTimes(2);
    await user.click(start);
    expect(mutate.mock.calls[2][0].command.body.countryCode).toBe("US");
    expect(
      mutate.mock.calls[2][0].command.body.allowLimitedAudit,
    ).toBeUndefined();
  });

  it.each([
    [false, "includeSitemaps"],
    [true, "includeSitemaps"],
    [false, "includePropertyTotals"],
    [true, "includePropertyTotals"],
  ] as const)(
    "keeps a changed private data choice separate from an uncertain request (monitor %s, %s)",
    async (monitor, field) => {
      mutate.mockRejectedValueOnce(new Error("Response lost after commit"));
      const user = userEvent.setup();
      const dialog = showDialog(workspace(), monitor);
      const choice = within(dialog).getByRole("checkbox", {
        name: messages.App.Seo.analysis[field],
      });
      const start = within(dialog).getByRole("button", {
        name: monitor
          ? messages.App.Seo.monitor.create
          : messages.App.Seo.analysis.submit,
      });
      expect(choice).toBeChecked();
      await user.click(start);
      await waitFor(() => expect(toastError).toHaveBeenCalled());
      await user.click(choice);
      await user.click(start);
      expect(mutate).toHaveBeenCalledTimes(1);
      const retry = toastError.mock.lastCall?.[1]?.action;
      mutate.mockResolvedValueOnce({
        ok: false,
        error: { kind: "seo_gsc_property", status: 409 },
      });
      await act(async () => retry.onClick());
      expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
      await user.click(start);
      const first = mutate.mock.calls[0][0].command.body;
      const changed = mutate.mock.calls[2][0].command.body;
      expect((monitor ? first.analysis : first).includePageDiscovery).toBe(
        true,
      );
      expect((monitor ? changed.analysis : changed).includePageDiscovery).toBe(
        field === "includePropertyTotals" ? undefined : true,
      );
      expect((monitor ? first.analysis : first)[field]).toBe(true);
      expect((monitor ? changed.analysis : changed)[field]).toBeUndefined();
      expect((monitor ? changed.analysis : changed).idempotencyKey).not.toBe(
        (monitor ? first.analysis : first).idempotencyKey,
      );
    },
  );

  it.each([false, true])(
    "replays the exact limited request after an uncertain acknowledgement (monitor %s)",
    async (monitor) => {
      mutate.mockResolvedValueOnce({
        ok: false,
        error: { kind: "seo_gsc_not_connected", status: 409 },
      });
      let finish!: () => void;
      mutate.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (!monitor) throw new Error("Response lost after commit");
        return {
          ok: false,
          error: { code: "INTERNAL_SERVER_ERROR", status: 503 },
        };
      });
      const user = userEvent.setup();
      const dialog = showDialog(workspace(), monitor);
      const start = within(dialog).getByRole("button", {
        name: monitor
          ? messages.App.Seo.monitor.create
          : messages.App.Seo.analysis.submit,
      });
      await user.click(start);
      await user.click(
        await screen.findByRole("button", {
          name: monitor ? "Schedule limited audits" : "Start limited audit",
        }),
      );
      expect(mutate).toHaveBeenCalledTimes(2);
      finish();
      await waitFor(() => expect(start).not.toHaveAttribute("aria-busy"));
      await user.click(start);
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(3));
      expect(mutate.mock.calls[2][0]).toEqual(mutate.mock.calls[1][0]);
    },
  );
});

describe("SEO check credits", () => {
  it("says the balance is too low when Core refuses the check for credits", async () => {
    mutate.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
        message: "Not enough credits.",
      },
    });
    const user = userEvent.setup(),
      dialog = showDialog(workspace());
    await user.click(
      within(dialog).getByRole("button", { name: "Start check" }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        messages.App.Seo.notEnoughCredits,
      ),
    );
  });
});

describe("full-audit price terms", () => {
  it("shows one price estimate and sends no price terms from the browser", async () => {
    const user = userEvent.setup(),
      dialog = showDialog(workspace());
    expect(within(dialog).getByText("Approximately 750 credits")).toBeVisible();
    expect(dialog).not.toHaveTextContent(
      /api costs|there is no maximum|for example, usd/i,
    );
    // A full audit has a minimum and no maximum: the line never says "up to".
    expect(within(dialog).queryByText(/Up to/)).toBeNull();
    expect(within(dialog).queryByRole("spinbutton")).toBeNull();
    expect(
      within(dialog).queryByRole("checkbox", { name: /price|credits/i }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Start check" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const body = mutate.mock.calls[0][0].command.body;
    expect(body).not.toHaveProperty("fullAuditPrice");
    expect(body).not.toHaveProperty("fullAuditCredits");
  });

  it("shows only the per-run estimate for a schedule of full audits", async () => {
    const user = userEvent.setup(),
      dialog = showDialog(workspace(), true);
    // The estimate by the button is the one price line.
    expect(
      within(dialog).getByText("Approximately 750 credits per run"),
    ).toBeVisible();
    expect(dialog).not.toHaveTextContent(
      /api costs|50 ?%|there is no maximum|for example, usd|AI Gateway/i,
    );
    expect(within(dialog).queryByText(/Up to/)).toBeNull();
    await user.click(
      within(dialog).getByRole("button", {
        name: messages.App.Seo.monitor.create,
      }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const body = mutate.mock.calls[0][0].command.body;
    expect(body.analysis).not.toHaveProperty("fullAuditPrice");
    expect(body.analysis).not.toHaveProperty("fullAuditCredits");
  });
});

describe("SEO monitor credits", () => {
  it("says the ceiling is per run, and prices only the requests one run makes", async () => {
    const user = userEvent.setup(),
      dialog = showDialog(workspace(), true);
    // A schedule repeats the full audit unless the reader picks another check.
    expect(
      within(within(dialog).getByTestId("seo-analysis-summary")).getByText(
        "Full audit",
      ),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Change options" }),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    // The price once, per run, by the button: no label and no fine print.
    expect(within(dialog).getByText("Up to 15 credits per run")).toBeVisible();
    expect(within(dialog).queryByText(/costs nothing/)).toBeNull();
    // A focused check keeps its own ceiling and shows no full-audit terms.
    expect(within(dialog).queryByText(/Vercel AI Gateway/)).toBeNull();
  });
});

describe("SEO check closed fields", () => {
  it("shows the fields when the browser refuses a value in a closed field", () => {
    const dialog = showDialog(workspace());
    const options = within(dialog).getByRole("button", {
      name: "Change options",
    });
    expect(options).toHaveAttribute("aria-expanded", "false");
    // A closed field cannot take focus, so the browser could not show its message.
    fireEvent.invalid(within(dialog).getByLabelText("Search language"));
    expect(options).toHaveAttribute("aria-expanded", "true");
  });

  it("says why the check cannot start with more than ten pages, with the fields closed", () => {
    const data = workspace();
    data.scope = {
      ...data.scope,
      pageIds: Array.from({ length: 11 }, (_, index) => `page-${index}`),
    };
    const dialog = showDialog(data);
    expect(
      within(dialog).getByRole("button", { name: "Change options" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Choose a single page or a group with up to 10 pages for this check.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Start check" }),
    ).toBeDisabled();
  });
});

describe("SEO check market selection", () => {
  it("submits only saved keywords for the selected market instead of mixing DE/de with US/en", async () => {
    const user = userEvent.setup(),
      dialog = showDialog(workspace());
    await openCheckOptions(user);
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    expect(within(dialog).getByLabelText("Search language")).toHaveValue("de");
    expect(within(dialog).getByLabelText("Keywords, one per line")).toHaveValue(
      "Akku Zustand",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Start check" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command.body).toMatchObject({
      countryCode: "DE",
      languageCode: "de",
      keywords: ["Akku Zustand"],
    });
  });

  it("restores edited and empty keyword drafts for each country and language", async () => {
    const user = userEvent.setup(),
      dialog = showDialog(workspace());
    await openCheckOptions(user);
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    const keywords = within(dialog).getByLabelText("Keywords, one per line");
    await user.clear(keywords);
    await user.type(keywords, "Mein Entwurf");
    await selectCountry(user, "US");
    fireEvent.change(within(dialog).getByLabelText("Search language"), {
      target: { value: "en" },
    });
    expect(keywords).toHaveValue("battery health");
    await user.clear(keywords);
    await user.type(keywords, "My edited keyword");
    await selectCountry(user, "DE");
    fireEvent.change(within(dialog).getByLabelText("Search language"), {
      target: { value: "de" },
    });
    expect(keywords).toHaveValue("Mein Entwurf");
    await user.clear(keywords);
    await selectCountry(user, "US");
    fireEvent.change(within(dialog).getByLabelText("Search language"), {
      target: { value: "en" },
    });
    expect(keywords).toHaveValue("My edited keyword");
    await selectCountry(user, "DE");
    fireEvent.change(within(dialog).getByLabelText("Search language"), {
      target: { value: "de" },
    });
    expect(keywords).toHaveValue("");
  });

  it("keeps HTML-only checks independent of keyword drafts and paid calls", async () => {
    const data = workspace();
    data.availableActions.canUsePaidSearchData = false;
    const user = userEvent.setup(),
      dialog = showDialog(data);
    expect(
      within(dialog).queryByLabelText("Keywords, one per line"),
    ).toBeNull();
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Start check" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command.body).toMatchObject({
      kind: "page_check",
      keywords: [],
      countryCode: "DE",
      languageCode: "de",
      maxProviderCalls: 0,
    });
  });
});
