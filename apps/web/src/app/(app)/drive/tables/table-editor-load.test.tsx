import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { get },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { session: { activeOrganizationId: "org" } } }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "date" }),
}));

import { TableEditor } from "./table-editor";

function renderEditor() {
  // The app's client: TanStack's default retries, no test-only shortcuts
  // beyond an instant retry delay.
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return render(
    <NuqsTestingAdapter>
      <QueryClientProvider client={client}>
        <TableEditor id="table-1" />
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );
}

beforeEach(() => {
  get.mockReset();
});
afterEach(cleanup);

it("says a table from another workspace is gone at once, with a way back", async () => {
  get.mockRejectedValue({ error: "NotFound", message: "Not found" });
  renderEditor();

  const back = await screen.findByRole("link", { name: "backToFiles" });
  expect(back.getAttribute("href")).toBe("/drive?view=tables");
  expect(screen.getByText("openFailed")).toBeTruthy();
  expect(screen.getByText("errors.missing")).toBeTruthy();
  // Asking again cannot bring it back, so nothing offers to.
  expect(screen.queryByRole("button", { name: "retry" })).toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
  // The live region carries the message only; the way back sits outside it.
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("openFailed")).toBeTruthy();
  expect(within(alert).queryByRole("link")).toBeNull();
});

it("offers a retry beside the way back when the request itself failed", async () => {
  get.mockRejectedValue(new TypeError("Failed to fetch"));
  renderEditor();

  expect(await screen.findByRole("button", { name: "retry" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "backToFiles" })).toBeTruthy();
  expect(within(screen.getByRole("alert")).queryByRole("button")).toBeNull();
});
