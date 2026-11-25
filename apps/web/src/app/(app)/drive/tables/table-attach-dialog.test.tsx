import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableAttachDialog } from "./table-attach-dialog";

const f = vi.hoisted(() => ({
  list: vi.fn(),
  file: vi.fn(),
  workspace: "org-a" as string | null,
  sessionLoaded: true,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Nov 23, 2026" }),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: f.sessionLoaded
      ? { session: { activeOrganizationId: f.workspace } }
      : null,
  }),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { list: f.list },
}));
vi.mock("./table-csv", () => ({ tableCsvFile: f.file }));

const leads = {
  id: "t1",
  title: "Leads",
  columnCount: 3,
  updatedAt: new Date(),
};

function renderDialog(
  client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
  }),
) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <TableAttachDialog onClose={onClose} onPick={onPick} />
    </QueryClientProvider>,
  );
  return { onPick, onClose, view };
}

async function choose(title: RegExp) {
  fireEvent.click(await screen.findByRole("radio", { name: title }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "add" }));
  });
}

beforeEach(() => {
  f.workspace = "org-a";
  f.sessionLoaded = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TableAttachDialog", () => {
  it("copies only after the reader confirms, and says the copy opens by link", async () => {
    f.list.mockResolvedValue({ items: [leads], nextCursor: null });
    const csv = new File(["a"], "Leads (2026-11-23).csv");
    f.file.mockResolvedValue(csv);
    const { onPick, onClose } = renderDialog();

    fireEvent.click(await screen.findByRole("radio", { name: /Leads/ }));
    expect(f.file).not.toHaveBeenCalled();
    expect(screen.getByText("publicCopy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() => expect(onPick).toHaveBeenCalledWith(csv));
    expect(f.file).toHaveBeenCalledWith("t1", expect.any(Date));
    expect(onClose).toHaveBeenCalled();
  });

  it("never hands back a copy that finishes after the picker was dismissed", async () => {
    f.list.mockResolvedValue({ items: [leads], nextCursor: null });
    const pending = Promise.withResolvers<File>();
    f.file.mockReturnValue(pending.promise);
    const { onPick, onClose } = renderDialog();

    await choose(/Leads/);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(new File(["a"], "Leads.csv"));
      await pending.promise;
    });

    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lists only the active workspace's Tables from a shared cache", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 60_000, gcTime: Number.POSITIVE_INFINITY },
        mutations: { gcTime: Number.POSITIVE_INFINITY },
      },
    });
    f.list.mockImplementation(() =>
      Promise.resolve({
        items: [
          { ...leads, id: String(f.workspace), title: `Plan ${f.workspace}` },
        ],
        nextCursor: null,
      }),
    );
    const first = renderDialog(client);
    await screen.findByRole("radio", { name: /Plan org-a/ });
    first.view.unmount();

    f.workspace = "org-b";
    renderDialog(client);

    expect(
      await screen.findByRole("radio", { name: /Plan org-b/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Plan org-a")).not.toBeInTheDocument();
  });

  it("loads the next page of Tables on request", async () => {
    f.list.mockImplementation(({ cursor }: { cursor?: string }) =>
      Promise.resolve(
        cursor === "p2"
          ? {
              items: [{ ...leads, id: "t2", title: "Older" }],
              nextCursor: null,
            }
          : { items: [leads], nextCursor: "p2" },
      ),
    );
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "loadMore" }));

    expect(
      await screen.findByRole("radio", { name: /Older/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Leads/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "loadMore" }),
    ).not.toBeInTheDocument();
  });

  it("gives keyboard focus back to the attach button when dismissed", async () => {
    f.list.mockResolvedValue({ items: [leads], nextCursor: null });
    const attach = document.createElement("button");
    document.body.append(attach);
    const onClose = vi.fn();
    const view = render(
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
        <TableAttachDialog
          onClose={onClose}
          onPick={vi.fn()}
          returnFocusRef={{ current: attach }}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole("radio", { name: /Leads/ });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    // The form unmounts the picker on close.
    view.unmount();

    await waitFor(() => expect(document.activeElement).toBe(attach));
    attach.remove();
  });

  it("never copies a Table the reader can no longer see after searching", async () => {
    f.list.mockImplementation(({ search }: { search?: string }) =>
      Promise.resolve({
        items: search ? [] : [leads],
        nextCursor: null,
      }),
    );
    renderDialog();

    fireEvent.click(await screen.findByRole("radio", { name: /Leads/ }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "nothing" },
    });
    await screen.findByText("noMatches");

    const add = screen.getByRole("button", { name: "add" });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(f.file).not.toHaveBeenCalled();
  });

  it("drops a copy still being made when the form unmounts the picker", async () => {
    f.list.mockResolvedValue({ items: [leads], nextCursor: null });
    const pending = Promise.withResolvers<File>();
    f.file.mockReturnValue(pending.promise);
    const { onPick, onClose, view } = renderDialog();

    await choose(/Leads/);
    view.unmount();
    await act(async () => {
      pending.resolve(new File(["a"], "Leads.csv"));
      await pending.promise;
    });

    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("waits for the session before listing any Tables", async () => {
    f.sessionLoaded = false;
    f.list.mockResolvedValue({ items: [leads], nextCursor: null });
    renderDialog();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(f.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("keeps the loaded Tables when the next page fails, and retries it", async () => {
    let fail = true;
    f.list.mockImplementation(({ cursor }: { cursor?: string }) => {
      if (cursor !== "p2")
        return Promise.resolve({ items: [leads], nextCursor: "p2" });
      if (fail) return Promise.reject(new Error("down"));
      return Promise.resolve({
        items: [{ ...leads, id: "t2", title: "Older" }],
        nextCursor: null,
      });
    });
    renderDialog(
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
          mutations: { gcTime: Number.POSITIVE_INFINITY },
        },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "loadMore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("loadMoreError");
    expect(screen.getByRole("radio", { name: /Leads/ })).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "loadMore" }));
    expect(
      await screen.findByRole("radio", { name: /Older/ }),
    ).toBeInTheDocument();
  });

  it("caps search at the 200 characters Core accepts", async () => {
    f.list.mockResolvedValue({ items: [], nextCursor: null });
    renderDialog();

    expect(await screen.findByRole("searchbox")).toHaveAttribute(
      "maxLength",
      "200",
    );
  });

  it("says why a Table over the row limit can't be added, and stays open", async () => {
    f.list.mockResolvedValue({
      items: [{ ...leads, title: "Huge" }],
      nextCursor: null,
    });
    f.file.mockResolvedValue(null);
    const { onPick, onClose } = renderDialog();

    await choose(/Huge/);

    expect(await screen.findByRole("alert")).toHaveTextContent("tooLarge");
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("points to Files when there are no Tables yet", async () => {
    f.list.mockResolvedValue({ items: [], nextCursor: null });
    renderDialog();

    expect(await screen.findByText("empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "openTables" })).toHaveAttribute(
      "href",
      "/drive?view=tables",
    );
  });
});
