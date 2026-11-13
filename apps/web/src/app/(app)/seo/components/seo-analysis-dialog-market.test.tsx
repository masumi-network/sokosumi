import type {
  ProjectSeoKeyword,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
function DialogHarness({ workspace }: { workspace: ProjectSeoWorkspace }) {
  return <SeoAnalysisDialog model={useSeoWorkspace(workspace)} />;
}
function showDialog(data: ProjectSeoWorkspace) {
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
          <DialogHarness workspace={data} />
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
    // The market of the saved keyword, by name, and the one keyword a full audit takes.
    expect(
      within(summary).getByText("Germany · German · Mobile and Desktop"),
    ).toBeVisible();
    expect(within(summary).getByText("Akku Zustand")).toBeVisible();
    // A one-page full audit shows the 45-credit ceiling Core checks before it starts.
    expect(within(dialog).getByText(/^Up to 45 credits: /)).toBeVisible();
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

  it("keeps the summary true to a changed field, and shows the fields when a value is refused", async () => {
    const data = workspace();
    data.keywords = [];
    const user = userEvent.setup(),
      dialog = showDialog(data);
    const summary = within(dialog).getByTestId("seo-analysis-summary");
    // No saved keyword and a .com page: the market falls back to US English.
    expect(
      within(summary).getByText("United States · English · Mobile and Desktop"),
    ).toBeVisible();
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
    expect(
      within(summary).getByText("United States · English · Desktop"),
    ).toBeVisible();
    expect(within(summary).getByText("Up to 20 data requests")).toBeVisible();
    expect(within(dialog).getByText(/^Up to 150 credits: /)).toBeVisible();
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
