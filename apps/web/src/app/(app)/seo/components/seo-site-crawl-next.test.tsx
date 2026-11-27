import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoCrawlNextButton } from "./seo-site-crawl-next";
import { seoTestWorkspace } from "./seo-test-fixture";
import { useSeoWorkspace } from "./use-seo-workspace";

const { mutate, toastError } = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));

const next = messages.App.Seo.siteCrawl.next;
const TO = "2026-10-01";
const clients: QueryClient[] = [];

function data() {
  const base = seoTestWorkspace();
  return {
    ...base,
    availableActions: {
      ...base.availableActions,
      continueCrawlFrom: "b".repeat(64),
    },
  };
}

function Harness({ workspace }: { workspace: ProjectSeoWorkspace }) {
  const model = useSeoWorkspace(workspace);
  return (
    <>
      <SeoCrawlNextButton model={model} />
      <button type="button" onClick={() => void model.setFilters({ to: TO })}>
        pick an end date
      </button>
    </>
  );
}

function show(
  read: (input: RequestInfo | URL) => Promise<Response> = async () =>
    Response.json(data()),
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
  clients.push(client);
  vi.stubGlobal("fetch", vi.fn(read));
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>
          <Harness workspace={data()} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mutate.mockResolvedValue({ ok: true, value: null });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("crawl of the next pages while other dates load", () => {
  it("offers no purchase from the old read", async () => {
    const user = userEvent.setup();
    // The read of the picked dates does not arrive.
    const read = async (input: RequestInfo | URL) =>
      String(input).includes(`to=${TO}`)
        ? new Promise<Response>(() => {})
        : Response.json(data());
    show(read);
    const button = screen.getByRole("button", { name: next.button });
    expect(button).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "pick an end date" }));
    await waitFor(() => expect(button).toBeDisabled());
  });
});

describe("uncertain crawl of the next pages", () => {
  it("replays the first paid request instead of starting a second one", async () => {
    mutate.mockRejectedValueOnce(new Error("Response lost"));
    const user = userEvent.setup();
    show();
    const start = async () => {
      await user.click(screen.getByRole("button", { name: next.button }));
      await user.click(screen.getByRole("button", { name: next.confirm }));
    };
    await start();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // A new confirmation brings a new key: it must not reach Core while the first is unconfirmed.
    await start();
    expect(mutate).toHaveBeenCalledTimes(1);
    const retry = toastError.mock.lastCall?.[1]?.action;
    expect(retry?.label).toBe(messages.App.Seo.analysis.retryPrevious);
    await act(async () => retry.onClick());
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
  });
});
