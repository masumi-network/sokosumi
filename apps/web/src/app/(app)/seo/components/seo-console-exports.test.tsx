import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoConsoleExports } from "./seo-console-exports";

const action = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/seo/console-export", () => ({
  readOrImportConsoleExport: action,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { user: { id: "owner" }, session: { activeOrganizationId: "org" } },
  }),
}));

beforeEach(() => {
  action.mockReset();
});
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { gcTime: Number.POSITIVE_INFINITY },
            mutations: { gcTime: Number.POSITIVE_INFINITY },
          },
        })
      }
    >
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SeoConsoleExports
          owner={{ kind: "audit", id: "audit" }}
          taskId="task"
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

it("loads private comparisons on demand and shows blank anchor text and matching dates", async () => {
  action.mockResolvedValue({
    ok: true,
    value: [
      {
        kind: "anchor_text",
        reason: null,
        date: "2026-01-02",
        sampleSize: 2,
        previousDate: "2026-01-01",
        newInSample: 1,
        absentFromSample: 0,
        entries: [
          { key: "", counts: {}, auditedUrl: false, previousCounts: null },
          { key: "Store", counts: {}, auditedUrl: false, previousCounts: {} },
        ],
      },
    ],
  });
  mount();
  expect(action).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText("Private Search Console exports"));
  expect(await screen.findByText("(Empty link text)")).toBeVisible();
  expect(
    screen.getByText(/Previous comparable export: 2026-01-01/),
  ).toBeVisible();
  expect(
    screen.getByText("Also present in the previous sample."),
  ).toBeVisible();
  expect(action).toHaveBeenCalledWith({
    owner: { kind: "audit", id: "audit" },
    taskId: "task",
    userId: "owner",
    organizationId: "org",
  });
});

it("uploads the owner's dated CSV and displays a same-day conflict without discarding the form", async () => {
  const user = userEvent.setup();
  action.mockImplementation(async ({ body }) =>
    body ? { ok: false, error: 409 } : { ok: true, value: [] },
  );
  mount();
  await user.click(screen.getByText("Private Search Console exports"));
  const file = new File(
    ["Target page,Incoming links,Linking sites\nhttps://example.test/,2,1"],
    "links.csv",
    { type: "text/csv" },
  );
  await user.upload(
    await screen.findByLabelText("CSV file (up to 256 KiB)"),
    file,
  );
  fireEvent.change(screen.getByLabelText("Date of this export"), {
    target: { value: "2026-03-01" },
  });
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Import sample" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A different file already exists",
  );
  expect(action).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        kind: "linked_pages",
        date: "2026-03-01",
        csv: await file.text(),
      },
    }),
  );
  expect(screen.getByLabelText("Date of this export")).toHaveValue(
    "2026-03-01",
  );
});
