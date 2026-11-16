import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
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
        <NuqsTestingAdapter>{content}</NuqsTestingAdapter>
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
  expect(dialog.getAllByRole("button", { name: "Close" })[0]).toBeVisible();
  expect(dialog.queryByRole("button", { name: /sync/i })).toBeNull();
  expect(
    screen.getByRole("dialog").querySelector('[type="submit"]'),
  ).toBeNull();
});

it("asks for the ambiguous connected provider before collecting its statistics", async () => {
  const user = userEvent.setup();
  const workspace = seoTestWorkspace();
  settingsNetwork(workspace);
  renderWithClient(<SeoWorkspace workspace={workspace} />);
  await user.click(
    await screen.findByRole("button", { name: "Choose a property" }),
  );
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("combobox", { name: "Source" })).toHaveTextContent(
    "Google Analytics",
  );
  expect(await dialog.findByLabelText("Property")).toBeVisible();
  expect(dialog.queryByRole("button", { name: /sync/i })).toBeNull();
});
