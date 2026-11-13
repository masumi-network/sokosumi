import type { Contact } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAILURE_TOAST_WAIT_MS,
  useContactArchive,
} from "./use-contact-archive";
import { CONTACTS_KEY } from "./use-contacts-data";

const f = vi.hoisted(() => ({
  archive: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));
vi.mock("sonner", () => ({
  toast: { error: f.toastError, success: f.toastSuccess },
}));
vi.mock("@/lib/auth/auth.client", () => ({ useSession: () => ({}) }));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { archive: f.archive },
}));

const ada = { id: "contact-1", name: "Ada" } as Contact;
const ben = { id: "contact-2", name: "Ben" } as Contact;
const key = [...CONTACTS_KEY, "ws", {}];

function setup() {
  const cache = new QueryClient();
  cache.setQueryData(key, {
    pages: [{ contacts: [ada, ben], nextCursor: null, total: 2 }],
    pageParams: [null],
  });
  const invalidate = vi.spyOn(cache, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useContactArchive(), { wrapper });
  const shown = () =>
    cache
      .getQueryData<{ pages: { contacts: Contact[] }[] }>(key)
      ?.pages.flatMap((page) => page.contacts.map((item) => item.id));
  return { archive: result.current, shown, invalidate, cache };
}

describe("useContactArchive", () => {
  beforeEach(() => vi.resetAllMocks());

  it("takes the row away and closes before Core answers", async () => {
    let finish = () => {};
    f.archive.mockReturnValueOnce(
      new Promise<void>((resolve) => void (finish = resolve)),
    );
    const { archive, shown, invalidate, cache } = setup();
    const onDone = vi.fn();
    let done = Promise.resolve();
    act(() => void (done = archive(ada, onDone)));
    expect(shown()).toEqual(["contact-2"]);
    expect(
      cache.getQueryData<{ pages: { total: number }[] }>(key)?.pages[0].total,
    ).toBe(1);
    expect(onDone).toHaveBeenCalledOnce();
    expect(f.archive).toHaveBeenCalledWith("contact-1");
    expect(f.toastSuccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    finish();
    await act(() => done);
    expect(f.toastSuccess).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CONTACTS_KEY });
  });

  it("says so and reloads the contacts when the save fails", async () => {
    f.archive.mockRejectedValueOnce({ message: "No access" });
    const { archive, invalidate } = setup();
    await act(() => archive(ada, () => {}));
    expect(f.toastError).toHaveBeenCalledWith("panel.archiveFailed Ada", {
      description: "No access",
    });
    expect(f.toastSuccess).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CONTACTS_KEY });
  });

  it("shows the failure toast once the reload has finished", async () => {
    f.archive.mockRejectedValueOnce({ message: "No access" });
    const { archive, invalidate } = setup();
    let reloaded = () => {};
    const reload = new Promise<void>((resolve) => void (reloaded = resolve));
    invalidate.mockImplementation(() => reload);
    let done = Promise.resolve();
    await act(async () => void (done = archive(ada, () => {})));
    expect(f.toastError).not.toHaveBeenCalled();
    reloaded();
    await act(() => done);
    expect(f.toastError).toHaveBeenCalledOnce();
  });

  it("shows the failure toast after the cap when the reload hangs", async () => {
    vi.useFakeTimers();
    try {
      f.archive.mockRejectedValueOnce({ message: "No access" });
      const { archive, invalidate } = setup();
      invalidate.mockImplementation(() => new Promise(() => {}));
      await act(async () => void archive(ada, () => {}));
      expect(f.toastError).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(FAILURE_TOAST_WAIT_MS));
      expect(f.toastError).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the answer of a page load that was under way off the grid", async () => {
    f.archive.mockReturnValueOnce(new Promise(() => {}));
    const { archive, shown, cache } = setup();
    let answer = (_: unknown) => {};
    void cache.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise((resolve) => void (answer = resolve)),
      staleTime: 0,
    });
    act(() => void archive(ada, () => {}));
    answer({ pages: [{ contacts: [ada, ben], nextCursor: null, total: 2 }] });
    await act(async () => {});
    expect(shown()).toEqual(["contact-2"]);
  });

  it("leaves a first page load and a list without the contact alone", async () => {
    f.archive.mockReturnValueOnce(new Promise(() => {}));
    const { archive, cache } = setup();
    const other = [...CONTACTS_KEY, "ws", { search: "ben" }];
    const without = {
      pages: [{ contacts: [ben], nextCursor: null, total: 1 }],
    };
    cache.setQueryData(other, without);
    const first = [...CONTACTS_KEY, "ws", { search: "new" }];
    const load = cache.fetchQuery({
      queryKey: first,
      queryFn: () => Promise.resolve(without),
    });
    act(() => void archive(ada, () => {}));
    expect(cache.getQueryData(other)).toBe(without);
    await expect(load).resolves.toBe(without);
  });
});
