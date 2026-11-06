import type {
  ProjectSeoKeyword,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
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
import { seoTestWorkspace } from "./seo-test-fixture";
import { useSeoWorkspace } from "./use-seo-workspace";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
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

describe("SEO check market selection", () => {
  it("submits only saved keywords for the selected market instead of mixing DE/de with US/en", async () => {
    const user = userEvent.setup(),
      dialog = showDialog(workspace());
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
