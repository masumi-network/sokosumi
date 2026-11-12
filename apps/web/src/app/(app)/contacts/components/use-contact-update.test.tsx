import type { Contact, ContactList } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useListToggle } from "./use-contact-update";
import { CONTACTS_KEY, contactKey } from "./use-contacts-data";

const f = vi.hoisted(() => ({ changeMembers: vi.fn(), toastError: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));
vi.mock("sonner", () => ({ toast: { error: f.toastError } }));
vi.mock("@/lib/auth/auth.client", () => ({ useSession: () => ({}) }));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { changeMembers: f.changeMembers },
}));

const list = { id: "list-1", name: "Investors", color: "blue" } as ContactList;
const contact = {
  id: "contact-1",
  name: "Ada",
  lists: [],
} as unknown as Contact;

function setup() {
  const cache = new QueryClient();
  cache.setQueryData(contactKey(contact.id), contact);
  const invalidate = vi.spyOn(cache, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useListToggle(), { wrapper });
  const shown = () =>
    cache.getQueryData<Contact>(contactKey(contact.id))?.lists ?? [];
  return {
    toggle: result.current.toggleList,
    shown,
    invalidate,
    cache,
    result,
  };
}

describe("useListToggle", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows the list on the contact before Core answers", async () => {
    let finish = () => {};
    f.changeMembers.mockReturnValue(
      new Promise<void>((resolve) => void (finish = resolve)),
    );
    const { toggle, shown, invalidate } = setup();
    let done = Promise.resolve();
    act(() => void (done = toggle(contact, list, true)));
    expect(shown()).toEqual([
      {
        id: "list-1",
        name: "Investors",
        color: "blue",
        addedAutomatically: false,
      },
    ]);
    await act(async () => {});
    expect(f.changeMembers).toHaveBeenCalledWith("list-1", {
      add: ["contact-1"],
    });
    expect(invalidate).not.toHaveBeenCalled();
    finish();
    await act(() => done);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: contactKey(contact.id),
    });
  });

  it("takes the list off the contact at once", async () => {
    f.changeMembers.mockReturnValue(new Promise(() => {}));
    const { toggle, shown } = setup();
    const member = {
      ...contact,
      lists: [
        {
          id: "list-1",
          name: "Investors",
          color: "blue",
          addedAutomatically: true,
        },
        {
          id: "list-2",
          name: "Press",
          color: "red",
          addedAutomatically: false,
        },
      ],
    } as Contact;
    act(() => void toggle(member, list, false));
    expect(shown().map((item) => item.id)).toEqual(["list-2"]);
    await act(async () => {});
    expect(f.changeMembers).toHaveBeenCalledWith("list-1", {
      remove: ["contact-1"],
    });
  });

  it("changes the contact in the grid's pages too", () => {
    f.changeMembers.mockReturnValue(new Promise(() => {}));
    const { toggle, cache } = setup();
    const key = [...CONTACTS_KEY, "ws", {}];
    cache.setQueryData(key, {
      pages: [{ contacts: [contact], nextCursor: null }],
      pageParams: [null],
    });
    act(() => void toggle(contact, list, true));
    const data = cache.getQueryData<{ pages: { contacts: Contact[] }[] }>(key);
    expect(data?.pages[0].contacts[0].lists.map((item) => item.id)).toEqual([
      "list-1",
    ]);
  });

  it("saves in click order and reloads once, after the last save", async () => {
    const answers: (() => void)[] = [];
    f.changeMembers.mockImplementation(
      () => new Promise<void>((resolve) => answers.push(resolve)),
    );
    const { toggle, shown, invalidate } = setup();
    const press = { ...list, id: "list-2", name: "Press" } as ContactList;
    let first = Promise.resolve();
    let second = Promise.resolve();
    act(() => void (first = toggle(contact, list, true)));
    act(
      () =>
        void (second = toggle(
          { ...contact, lists: shown() } as Contact,
          press,
          true,
        )),
    );
    // The second save waits for the first.
    await act(async () => {});
    expect(f.changeMembers).toHaveBeenCalledOnce();
    answers[0]();
    await act(() => first);
    // No reload between the two: it would drop the second chip.
    expect(invalidate).not.toHaveBeenCalled();
    expect(shown().map((item) => item.id)).toEqual(["list-1", "list-2"]);
    expect(f.changeMembers).toHaveBeenCalledTimes(2);
    answers[1]();
    await act(() => second);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: contactKey(contact.id),
    });
  });

  it("keeps the answer of a load that was under way off the chip", async () => {
    f.changeMembers.mockReturnValue(new Promise(() => {}));
    const { toggle, shown, cache } = setup();
    let answer = (_: Contact) => {};
    const load = cache.fetchQuery({
      queryKey: contactKey(contact.id),
      queryFn: () => new Promise<Contact>((resolve) => void (answer = resolve)),
      staleTime: 0,
    });
    load.catch(() => {});
    act(() => void toggle(contact, list, true));
    answer(contact);
    await act(async () => {});
    expect(shown().map((item) => item.id)).toEqual(["list-1"]);
  });

  it("lets a first load of the grid pages finish", async () => {
    f.changeMembers.mockReturnValue(new Promise(() => {}));
    const { toggle, cache } = setup();
    const key = [...CONTACTS_KEY, "ws", {}];
    const pages = { pages: [{ contacts: [], nextCursor: null }] };
    const load = cache.fetchQuery({
      queryKey: key,
      queryFn: () => Promise.resolve(pages),
    });
    act(() => void toggle(contact, list, true));
    await expect(load).resolves.toEqual(pages);
  });

  it("still sends the next save when the one before it failed", async () => {
    f.changeMembers
      .mockRejectedValueOnce({ message: "No access" })
      .mockResolvedValueOnce(undefined);
    const { toggle } = setup();
    await act(async () => {
      void toggle(contact, list, true);
      await toggle(contact, list, false);
    });
    expect(f.changeMembers).toHaveBeenCalledTimes(2);
    expect(f.toastError).toHaveBeenCalledOnce();
  });

  it("says so and reloads the contact when the save fails", async () => {
    f.changeMembers.mockRejectedValue({ message: "No access" });
    const { toggle, invalidate } = setup();
    await act(() => toggle(contact, list, true));
    expect(f.toastError).toHaveBeenCalledWith(
      "panel.addToListFailed Ada Investors",
      { description: "No access" },
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: contactKey(contact.id),
    });
    // The toast says the list is back, so it waits for the reload.
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      f.toastError.mock.invocationCallOrder[0],
    );
  });

  it("names the contact and list when taking it off fails", async () => {
    f.changeMembers.mockRejectedValue({});
    const { toggle } = setup();
    await act(() => toggle(contact, list, false));
    expect(f.toastError).toHaveBeenCalledWith(
      "panel.removeFromListFailed Ada Investors",
      { description: undefined },
    );
  });

  it("marks the list as saving until the save answers", async () => {
    let finish = () => {};
    f.changeMembers.mockReturnValue(
      new Promise<void>((resolve) => void (finish = resolve)),
    );
    const { toggle, result } = setup();
    let done = Promise.resolve();
    act(() => void (done = toggle(contact, list, true)));
    expect(result.current.isSaving("contact-1", "list-1")).toBe(true);
    expect(result.current.isSaving("contact-1", "list-2")).toBe(false);
    finish();
    await act(() => done);
    expect(result.current.isSaving("contact-1", "list-1")).toBe(false);
  });
});
