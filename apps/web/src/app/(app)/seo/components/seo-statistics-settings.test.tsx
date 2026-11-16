import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoStatisticsDialog } from "./seo-statistics-dialog";
import { seoTestWorkspace } from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoWorkspace } from "./use-seo-workspace";

vi.mock("@/lib/actions/seo/action", () => ({
  mutateSeo: vi.fn(async () => ({ ok: true, value: null })),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      session: { activeOrganizationId: "org" },
      user: { id: "owner" },
    },
  }),
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

function settingsNetwork(workspace: ReturnType<typeof seoTestWorkspace>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "https://web.test");
      if (url.pathname.includes("/connections/"))
        return Response.json({
          provider: url.pathname.split("/").at(-1),
          name: "Google Analytics",
          status: url.pathname.endsWith("/ga4") ? "connected" : "not_connected",
          source: "native",
        });
      if (url.pathname.endsWith("statistics/properties"))
        return Response.json({
          provider: "ga4",
          status: "available",
          reason: null,
          // Neither Analytics name identifies the selected site. The reader
          // chooses a property without a separate Sync confirmation.
          properties: [
            { id: "properties/1", name: "First property" },
            { id: "properties/2", name: "Second property" },
          ],
        });
      return Response.json(workspace);
    }),
  );
}

function renderWithClient(content: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>{content}</NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

it("keeps property settings available without requiring a manual Sync step", async () => {
  const workspace = seoTestWorkspace();
  settingsNetwork(workspace);
  function Settings() {
    const model = useSeoWorkspace(workspace);
    return <SeoStatisticsDialog model={model} source="ga4" />;
  }
  renderWithClient(<Settings />);
  const dialog = within(screen.getByRole("dialog"));
  expect(await dialog.findByLabelText("Property")).toBeVisible();
  // The dialog opened for Google Analytics: its section has the focus, not the first source's control.
  await waitFor(() =>
    expect(
      dialog.getByRole("region", { name: "Google Analytics" }),
    ).toHaveFocus(),
  );
  expect(dialog.getAllByRole("button", { name: "Close" })[0]).toBeVisible();
  expect(dialog.queryByRole("button", { name: /sync/i })).toBeNull();
  expect(
    screen.getByRole("dialog").querySelector('[type="submit"]'),
  ).toBeNull();
});

it("shows the connected source's property choice beside the other source", async () => {
  const user = userEvent.setup();
  const workspace = seoTestWorkspace();
  settingsNetwork(workspace);
  renderWithClient(<SeoWorkspace workspace={workspace} />);
  expect(
    screen.queryByRole("button", { name: "Choose a property" }),
  ).toBeNull();
  await user.click(screen.getByRole("tab", { name: "Traffic" }));
  await user.click(
    await screen.findByRole("button", { name: "Choose a property" }),
  );
  const dialog = within(screen.getByRole("dialog"));
  const analytics = within(
    dialog.getByRole("region", { name: "Google Analytics" }),
  );
  expect(await analytics.findByLabelText("Property")).toBeVisible();
  // Search Console is not connected: its section offers the connection, not a property.
  const search = within(dialog.getByRole("region", { name: "Search Console" }));
  expect(
    await search.findByRole("button", { name: "Connect Search Console" }),
  ).toBeVisible();
  expect(search.queryByLabelText("Property")).toBeNull();
  expect(dialog.queryByRole("button", { name: /sync/i })).toBeNull();
});

function connectedSearchConsole(properties: { id: string; name: string }[]) {
  const workspace = seoTestWorkspace();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "https://web.test");
      if (url.pathname.includes("/connections/"))
        return Response.json({
          provider: url.pathname.split("/").at(-1),
          name: "Search Console",
          status: url.pathname.endsWith("/search_console")
            ? "connected"
            : "not_connected",
          source: "native",
        });
      if (url.pathname.endsWith("statistics/properties"))
        return Response.json({
          provider: "search_console",
          status: "available",
          reason: null,
          properties,
        });
      return Response.json(workspace);
    }),
  );
  return workspace;
}

it("gives the first focus to no button when the account states are already known", async () => {
  const workspace = connectedSearchConsole([
    { id: "sc-domain:example.com", name: "Example website" },
  ]);
  function Settings() {
    const model = useSeoWorkspace(workspace);
    const search = useSeoConnectionStatus("search_console").status.data;
    const analytics = useSeoConnectionStatus("ga4").status.data;
    // The dialog opens after both reads, as it does once the automatic collection has run.
    return search && analytics ? <SeoStatisticsDialog model={model} /> : null;
  }
  renderWithClient(<Settings />);
  const dialog = await screen.findByRole("dialog");
  // One Enter must not start the Google Analytics approval.
  await waitFor(() =>
    expect(dialog).toContainElement(document.activeElement as HTMLElement),
  );
  expect(document.activeElement?.tagName).not.toBe("BUTTON");
});

it("does not claim a read from the one property that misses the selected pages", async () => {
  const workspace = connectedSearchConsole([
    { id: "sc-domain:unrelated.example", name: "Other" },
  ]);
  function Settings() {
    const model = useSeoWorkspace(workspace);
    return <SeoStatisticsDialog model={model} />;
  }
  renderWithClient(<Settings />);
  const search = within(
    await screen.findByRole("region", { name: "Search Console" }),
  );
  expect(
    await search.findByText(messages.App.Seo.statistics.propertyNotMatching),
  ).toBeVisible();
  expect(
    search.queryByTestId("seo-statistics-reads-search_console"),
  ).toBeNull();
});
