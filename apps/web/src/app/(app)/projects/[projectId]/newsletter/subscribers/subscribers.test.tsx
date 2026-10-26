import {
  type NewsletterSubscriber,
  type NewsletterSubscriberList,
  NewsletterSubscriberSource,
  NewsletterSubscriberStatus,
  type PaginationMetadata,
} from "@sokosumi/core-client";
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
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  import: vi.fn(),
  status: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  url: vi.fn(),
}));
vi.mock("@/lib/actions/newsletter/subscribers", () => ({
  addNewsletterSubscriber: mocks.add,
  importNewsletterSubscribers: mocks.import,
  changeNewsletterSubscriberStatus: mocks.status,
  removeNewsletterSubscriber: mocks.remove,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

import { Subscribers } from "./subscribers";

const PERSON: NewsletterSubscriber = {
  id: "s1",
  newsletterId: "n1",
  email: "ada@example.com",
  name: "Ada",
  status: NewsletterSubscriberStatus.ACTIVE,
  source: NewsletterSubscriberSource.MANUAL,
  createdAt: new Date("2026-10-01T12:00:00Z"),
  consentAt: new Date("2026-10-01T12:00:00Z"),
  confirmedAt: null,
  unsubscribedAt: null,
  bouncedAt: null,
};
const DATA: NewsletterSubscriberList = {
  subscribers: [PERSON],
  counts: { ACTIVE: 12, PENDING: 2, UNSUBSCRIBED: 3, BOUNCED: 1 },
};
const PAGINATION: PaginationMetadata = {
  cursor: null,
  nextCursor: "s2",
  limit: 25,
  total: 18,
};
const EMPTY: NewsletterSubscriberList = {
  subscribers: [],
  counts: { ACTIVE: 0, PENDING: 0, UNSUBSCRIBED: 0, BOUNCED: 0 },
};
const COPY = en.App.Projects.Newsletter.Subscribers;

function renderSubscribers({
  data = DATA,
  pagination = PAGINATION,
  searchParams = "",
  locale = "en",
}: {
  data?: NewsletterSubscriberList;
  pagination?: PaginationMetadata;
  searchParams?: string;
  locale?: "en" | "de" | "es";
} = {}) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ en, de, es }[locale]}
      timeZone="UTC"
    >
      <NuqsTestingAdapter
        searchParams={searchParams}
        onUrlUpdate={mocks.url}
        hasMemory
      >
        <Subscribers projectId="p1" data={data} pagination={pagination} />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
}

async function openAdd() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: COPY.add }));
  return { user, dialog: within(screen.getByRole("dialog")) };
}

async function openImport() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: COPY.import }));
  return { user, dialog: within(screen.getByRole("dialog")) };
}

function chooseCsv(
  dialog: ReturnType<typeof within>,
  name = "subscribers.csv",
  size?: number,
) {
  const file = new File(["email,name\nnew@example.com,New"], name, {
    type: "text/csv",
  });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  fireEvent.change(dialog.getByLabelText(COPY.Import.file), {
    target: { files: [file] },
  });
  return file;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.add.mockResolvedValue({ ok: true, value: PERSON });
  mocks.import.mockResolvedValue({
    ok: true,
    value: { imported: 1, skippedExisting: 0, invalid: [] },
  });
  mocks.status.mockResolvedValue({ ok: true, value: PERSON });
  mocks.remove.mockResolvedValue({ ok: true, value: null });
});

describe("newsletter subscribers", () => {
  it.each([
    NewsletterSubscriberStatus.UNSUBSCRIBED,
    NewsletterSubscriberStatus.BOUNCED,
  ])(
    "preserves suppression by offering no reactivation or removal for %s",
    (status) => {
      renderSubscribers({
        data: {
          ...DATA,
          subscribers: [{ ...PERSON, status }],
        },
      });
      expect(
        screen.queryByRole("button", {
          name: `Manage subscriber ${PERSON.email}`,
        }),
      ).not.toBeInTheDocument();
      expect(mocks.status).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it("shows counts and both empty-state entry actions", () => {
    renderSubscribers({ data: EMPTY });
    expect(
      screen.getByRole("heading", { name: COPY.emptyTitle }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY.add })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: COPY.import }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("uses the shared table with translated columns, status, source and date", () => {
    renderSubscribers();
    const table = within(screen.getByRole("table"));
    for (const label of Object.values(COPY.columns))
      expect(
        table.getByRole("columnheader", { name: label }),
      ).toBeInTheDocument();
    expect(table.getByText(PERSON.email)).toBeInTheDocument();
    expect(table.getByText(COPY.statuses.ACTIVE)).toBeInTheDocument();
    expect(table.getByText(COPY.sources.MANUAL)).toBeInTheDocument();
    expect(table.getByText("Oct 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("18 matching subscribers")).toBeInTheDocument();
  });

  it("submits an email search and resets the cursor", async () => {
    const user = userEvent.setup();
    renderSubscribers({ searchParams: "?cursor=s1&status=ACTIVE" });
    await user.type(screen.getByRole("searchbox"), "  example.com  ");
    await user.click(screen.getByRole("button", { name: COPY.searchButton }));
    await waitFor(() => expect(mocks.url).toHaveBeenCalled());
    const params: URLSearchParams = mocks.url.mock.lastCall?.[0].searchParams;
    expect(params.get("search")).toBe("example.com");
    expect(params.get("status")).toBe("ACTIVE");
    expect(params.has("cursor")).toBe(false);
  });

  it("filters status and resets pagination", async () => {
    const user = userEvent.setup();
    renderSubscribers({ searchParams: "?search=example&cursor=s1" });
    await user.click(screen.getByRole("combobox", { name: COPY.filterStatus }));
    await user.click(
      screen.getByRole("option", { name: COPY.statuses.BOUNCED }),
    );
    await waitFor(() => expect(mocks.url).toHaveBeenCalled());
    const params: URLSearchParams = mocks.url.mock.lastCall?.[0].searchParams;
    expect(params.get("status")).toBe("BOUNCED");
    expect(params.get("search")).toBe("example");
    expect(params.has("cursor")).toBe(false);
  });

  it("paginates with Core’s cursor", async () => {
    const user = userEvent.setup();
    renderSubscribers();
    expect(screen.getByRole("button", { name: COPY.firstPage })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: COPY.nextPage }));
    await waitFor(() => expect(mocks.url).toHaveBeenCalled());
    expect(mocks.url.mock.lastCall?.[0].searchParams.get("cursor")).toBe("s2");
  });

  it("returns to the first page while retaining filters", async () => {
    const user = userEvent.setup();
    renderSubscribers({
      pagination: { ...PAGINATION, cursor: "s1" },
      searchParams: "?cursor=s1&status=ACTIVE",
    });
    await user.click(screen.getByRole("button", { name: COPY.firstPage }));
    await waitFor(() => expect(mocks.url).toHaveBeenCalled());
    expect(mocks.url.mock.lastCall?.[0].searchParams.has("cursor")).toBe(false);
    expect(mocks.url.mock.lastCall?.[0].searchParams.get("status")).toBe(
      "ACTIVE",
    );
  });

  it("allows clearing an empty filter result and returning from a stale cursor", async () => {
    const user = userEvent.setup();
    renderSubscribers({
      data: { ...DATA, subscribers: [] },
      pagination: { ...PAGINATION, cursor: "s1", nextCursor: null, total: 0 },
      searchParams: "?search=missing&status=ACTIVE&cursor=s1",
    });
    expect(screen.getByRole("button", { name: COPY.nextPage })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: COPY.clearFilters }));
    await waitFor(() => expect(mocks.url).toHaveBeenCalled());
    expect(mocks.url.mock.lastCall?.[0].queryString).toBe("");
  });

  it("validates consent before adding, then adds and refreshes", async () => {
    renderSubscribers({ data: EMPTY });
    const { user, dialog } = await openAdd();
    await user.type(dialog.getByLabelText(COPY.Add.email), "new@example.com");
    await user.click(dialog.getByRole("button", { name: COPY.add }));
    expect(
      await dialog.findByText(COPY.Validation.consent),
    ).toBeInTheDocument();
    expect(mocks.add).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("checkbox", { name: COPY.Add.consent }));
    await user.click(dialog.getByRole("button", { name: COPY.add }));
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith({
        projectId: "p1",
        values: { email: "new@example.com", name: "", consent: true },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("keeps duplicate errors inline and retains the typed subscriber", async () => {
    mocks.add.mockResolvedValue({
      ok: false,
      error: {
        message: COPY.Add.duplicate,
        fieldErrors: { email: [COPY.Add.duplicate] },
      },
    });
    renderSubscribers();
    const { user, dialog } = await openAdd();
    await user.type(dialog.getByLabelText(COPY.Add.email), PERSON.email);
    await user.click(dialog.getByRole("checkbox", { name: COPY.Add.consent }));
    await user.click(dialog.getByRole("button", { name: COPY.add }));
    expect(await dialog.findByText(COPY.Add.duplicate)).toBeInTheDocument();
    expect(dialog.getByLabelText(COPY.Add.email)).toHaveValue(PERSON.email);
    expect(dialog.getByLabelText(COPY.Add.email)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("blocks duplicate submissions and dismissal while adding, then restores focus", async () => {
    const deferred = Promise.withResolvers<{
      ok: true;
      value: NewsletterSubscriber;
    }>();
    mocks.add.mockReturnValue(deferred.promise);
    renderSubscribers();
    const { user, dialog } = await openAdd();
    await user.type(dialog.getByLabelText(COPY.Add.email), PERSON.email);
    await user.click(dialog.getByRole("checkbox", { name: COPY.Add.consent }));
    await user.click(dialog.getByRole("button", { name: COPY.add }));
    expect(dialog.getByRole("button", { name: COPY.add })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(dialog.getByRole("button", { name: COPY.cancel })).toBeDisabled();
    expect(dialog.getByLabelText(COPY.Add.email)).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: COPY.add }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => deferred.resolve({ ok: true, value: PERSON }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.add })).toHaveFocus(),
    );
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected add open for retry", async () => {
    mocks.add.mockRejectedValue(new Error("Network"));
    renderSubscribers();
    const { user, dialog } = await openAdd();
    await user.type(dialog.getByLabelText(COPY.Add.email), PERSON.email);
    await user.click(dialog.getByRole("checkbox", { name: COPY.Add.consent }));
    await user.click(dialog.getByRole("button", { name: COPY.add }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(COPY.Add.error);
  });

  it.each([
    ["wrong.txt", 1, COPY.Import.fileType],
    ["large.csv", 5_000_001, COPY.Import.fileSize],
  ])(
    "rejects invalid file %s before importing",
    async (name, size, message) => {
      renderSubscribers();
      const { dialog } = await openImport();
      chooseCsv(dialog, name, size);
      expect(dialog.getByText(message)).toBeInTheDocument();
      expect(mocks.import).not.toHaveBeenCalled();
    },
  );

  it("requires a file and explicit import consent", async () => {
    renderSubscribers();
    const { user, dialog } = await openImport();
    await user.click(dialog.getByRole("button", { name: COPY.import }));
    expect(dialog.getByText(COPY.Import.fileRequired)).toBeInTheDocument();
    expect(dialog.getByText(COPY.Validation.consent)).toBeInTheDocument();
    chooseCsv(dialog);
    await user.click(dialog.getByRole("button", { name: COPY.import }));
    expect(mocks.import).not.toHaveBeenCalled();
  });

  it("reads CSV text in the browser and shows import, duplicate and invalid-row results", async () => {
    mocks.import.mockResolvedValue({
      ok: true,
      value: {
        imported: 3,
        skippedExisting: 2,
        invalid: Array.from({ length: 7 }, (_, i) => ({
          row: i + 4,
          value: `invalid-${i}`,
        })),
      },
    });
    renderSubscribers();
    const { user, dialog } = await openImport();
    const file = chooseCsv(dialog, "subscribers.csv", 5_000_000);
    await user.click(
      dialog.getByRole("checkbox", { name: COPY.Import.consent }),
    );
    await user.click(dialog.getByRole("button", { name: COPY.import }));
    await waitFor(() => expect(mocks.import).toHaveBeenCalled());
    const values: FormData = mocks.import.mock.lastCall?.[0].values;
    const csv = values.get("csv");
    expect(csv).toBeInstanceOf(Blob);
    expect(csv instanceof Blob && (await csv.text())).toBe(await file.text());
    expect(values.get("consent")).toBe("true");
    expect(await dialog.findByText("Row 4: invalid-0")).toBeInTheDocument();
    expect(dialog.queryByText("Row 9: invalid-5")).not.toBeInTheDocument();
    expect(
      dialog.getByText("2 more invalid rows reported"),
    ).toBeInTheDocument();
    for (const label of Object.values(COPY.Import.result))
      expect(dialog.getByText(label)).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: COPY.done }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains the import file when Core rejects it", async () => {
    mocks.import.mockResolvedValue({
      ok: false,
      error: { message: COPY.Import.invalidCsv },
    });
    renderSubscribers();
    const { user, dialog } = await openImport();
    chooseCsv(dialog);
    await user.click(
      dialog.getByRole("checkbox", { name: COPY.Import.consent }),
    );
    await user.click(dialog.getByRole("button", { name: COPY.import }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      COPY.Import.invalidCsv,
    );
    expect(dialog.getByText("subscribers.csv")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(["read", "request"])(
    "handles an import %s failure without losing the file",
    async (failure) => {
      renderSubscribers();
      const { user, dialog } = await openImport();
      const file = chooseCsv(dialog);
      if (failure === "read")
        vi.spyOn(file, "text").mockRejectedValue(new Error("Unreadable"));
      else mocks.import.mockRejectedValue(new Error("Network"));
      await user.click(
        dialog.getByRole("checkbox", { name: COPY.Import.consent }),
      );
      await user.click(dialog.getByRole("button", { name: COPY.import }));
      expect(await dialog.findByRole("alert")).toHaveTextContent(
        COPY.Import.error,
      );
      expect(dialog.getByText(file.name)).toBeInTheDocument();
      expect(mocks.refresh).not.toHaveBeenCalled();
      if (failure === "read") expect(mocks.import).not.toHaveBeenCalled();
    },
  );

  it("keeps the import dialog open while running and restores focus when done", async () => {
    const deferred = Promise.withResolvers<{
      ok: true;
      value: { imported: number; skippedExisting: number; invalid: [] };
    }>();
    mocks.import.mockReturnValue(deferred.promise);
    renderSubscribers();
    const { user, dialog } = await openImport();
    chooseCsv(dialog);
    await user.click(
      dialog.getByRole("checkbox", { name: COPY.Import.consent }),
    );
    await user.click(dialog.getByRole("button", { name: COPY.import }));
    expect(dialog.getByRole("button", { name: COPY.import })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(dialog.getByLabelText(COPY.Import.file)).toBeDisabled();
    expect(dialog.getByRole("button", { name: COPY.cancel })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () =>
      deferred.resolve({
        ok: true,
        value: { imported: 1, skippedExisting: 0, invalid: [] },
      }),
    );
    await user.click(dialog.getByRole("button", { name: COPY.done }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.import })).toHaveFocus(),
    );
  });

  it.each([
    [
      NewsletterSubscriberStatus.ACTIVE,
      COPY.unsubscribe,
      NewsletterSubscriberStatus.UNSUBSCRIBED,
    ],
  ])("changes status only for %s", async (status, label, target) => {
    const user = userEvent.setup();
    renderSubscribers({
      data: { ...DATA, subscribers: [{ ...PERSON, status }] },
    });
    await user.click(
      screen.getByRole("button", { name: `Manage subscriber ${PERSON.email}` }),
    );
    await user.click(screen.getByRole("menuitem", { name: label }));
    expect(mocks.status).toHaveBeenCalledWith({
      projectId: "p1",
      subscriberId: PERSON.id,
      status: target,
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it.each([NewsletterSubscriberStatus.PENDING])(
    "offers removal only for %s",
    async (status) => {
      const user = userEvent.setup();
      renderSubscribers({
        data: { ...DATA, subscribers: [{ ...PERSON, status }] },
      });
      await user.click(
        screen.getByRole("button", {
          name: `Manage subscriber ${PERSON.email}`,
        }),
      );
      expect(screen.getAllByRole("menuitem")).toHaveLength(1);
      expect(
        screen.getByRole("menuitem", { name: COPY.remove }),
      ).toBeInTheDocument();
    },
  );

  it("reports stale status errors without claiming success", async () => {
    mocks.status.mockResolvedValue({
      ok: false,
      error: { message: COPY.transitionError },
    });
    const user = userEvent.setup();
    renderSubscribers();
    await user.click(
      screen.getByRole("button", { name: `Manage subscriber ${PERSON.email}` }),
    );
    await user.click(screen.getByRole("menuitem", { name: COPY.unsubscribe }));
    expect(mocks.error).toHaveBeenCalledWith(COPY.transitionError, {
      duration: Infinity,
      cancel: { label: COPY.dismiss, onClick: expect.any(Function) },
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("confirms removal, keeps failures visible, and allows retry", async () => {
    mocks.remove.mockResolvedValueOnce({
      ok: false,
      error: { message: COPY.Remove.error },
    });
    const user = userEvent.setup();
    renderSubscribers();
    await user.click(
      screen.getByRole("button", { name: `Manage subscriber ${PERSON.email}` }),
    );
    await user.click(screen.getByRole("menuitem", { name: COPY.remove }));
    const dialog = within(screen.getByRole("alertdialog"));
    expect(
      dialog.getByText(
        COPY.Remove.description.replace("{email}", PERSON.email),
      ),
    ).toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: COPY.remove }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      COPY.Remove.error,
    );
    await user.click(dialog.getByRole("button", { name: COPY.remove }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(mocks.remove).toHaveBeenCalledWith({
      projectId: "p1",
      subscriberId: PERSON.id,
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it.each(["de", "es"] as const)(
    "renders subscriber statuses and sources in %s",
    (locale) => {
      const copy = { de, es }[locale].App.Projects.Newsletter.Subscribers;
      const statuses = Object.values(NewsletterSubscriberStatus);
      const sources = Object.values(NewsletterSubscriberSource);
      renderSubscribers({
        locale,
        data: {
          ...DATA,
          subscribers: statuses.map((status, i) => ({
            ...PERSON,
            id: `s${i}`,
            status,
            source: sources[i],
          })),
        },
      });
      const table = within(screen.getByRole("table"));
      for (const status of statuses)
        expect(table.getByText(copy.statuses[status])).toBeInTheDocument();
      for (const source of sources)
        expect(table.getByText(copy.sources[source])).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: copy.add }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: copy.import }),
      ).toBeInTheDocument();
    },
  );
});
