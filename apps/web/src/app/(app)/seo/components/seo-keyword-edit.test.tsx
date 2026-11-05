import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoEditDialog } from "./seo-edit-dialog";
import { SeoKeywords } from "./seo-keywords";
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
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function KeywordWorkspace({ workspace }: { workspace: ProjectSeoWorkspace }) {
  const model = useSeoWorkspace(workspace);
  return (
    <>
      <SeoKeywords model={model} />
      {model.dialog === "edit_keyword" ? <SeoEditDialog model={model} /> : null}
    </>
  );
}
function renderWorkspace(workspace: ProjectSeoWorkspace) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>
          <KeywordWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function savedKeywordWorkspace() {
  const workspace = seoTestWorkspace();
  const pricingPage = {
    ...workspace.pages[0],
    id: "a658c5bb-3084-4b26-81ee-b3208ee5ab61",
    label: "Pricing",
    url: "https://example.com/pricing",
  };
  workspace.pages.push(pricingPage);
  workspace.keywords.push({
    id: "saved-keyword",
    keyword: "Stablecoins",
    countryCode: "DE",
    languageCode: "de",
    pageUrl: pricingPage.url,
    targetPageId: workspace.pages[0].id,
    saved: true,
    priority: "medium",
    version: 3,
    source: "saved",
    volume: null,
    intent: null,
    device: null,
    position: null,
    positionStatus: "unavailable",
    checkedResults: null,
    observedAt: null,
    observationId: null,
  });
  return { workspace, pricingPage };
}

describe("Saved keyword edits", () => {
  it("removes a saved keyword without replacing its target with the observed ranking page", async () => {
    const user = userEvent.setup();
    const { workspace } = savedKeywordWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Remove from saved" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          kind: "save_keyword",
          body: expect.objectContaining({
            pageId: workspace.pages[0].id,
            saved: false,
            expectedVersion: 3,
          }),
        },
      }),
    );
  });

  it("edits a saved keyword target and priority with the version shown when editing began", async () => {
    const user = userEvent.setup();
    const { workspace, pricingPage } = savedKeywordWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    const view = renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit keyword" });
    expect(within(dialog).getByLabelText("Keyword")).toHaveAttribute(
      "readonly",
    );
    expect(within(dialog).getByLabelText("Country code")).toHaveValue("DE");
    expect(
      within(dialog).getByRole("combobox", { name: "Target page" }),
    ).toHaveTextContent("Home");
    await act(async () => {
      view.client.setQueryData(
        ["seo-workspace", "org", "owner", "project", workspace.projectId, ""],
        {
          ...workspace,
          keywords: workspace.keywords.map((row) => ({ ...row, version: 4 })),
        },
      );
    });
    await user.click(
      within(dialog).getByRole("combobox", { name: "Target page" }),
    );
    await user.click(screen.getByRole("option", { name: "Pricing" }));
    await user.click(
      within(dialog).getByRole("combobox", { name: "Priority" }),
    );
    await user.click(screen.getByRole("option", { name: "High" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "save_keyword",
        body: {
          keyword: "Stablecoins",
          countryCode: "DE",
          languageCode: "de",
          pageId: pricingPage.id,
          saved: true,
          priority: "high",
          expectedVersion: 3,
        },
      },
    });
  });
});
