import type { Contact } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactQuery } from "@/lib/services/contacts.client";
import { useContactRows } from "./use-contacts-data";

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "ws" }, user: { id: "u" } },
  }),
}));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { list },
}));

const page = (id: string) => ({
  contacts: [{ id, name: id } as Contact],
  nextCursor: null,
  total: 1,
});
const never = () => new Promise(() => {});

function setup(first: ContactQuery) {
  const cache = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  return renderHook(({ query }) => useContactRows(query), {
    wrapper,
    initialProps: { query: first },
  });
}

const shown = (data: { pages: { contacts: Contact[] }[] } | undefined) =>
  data?.pages.flatMap((item) => item.contacts.map((contact) => contact.id));

describe("useContactRows placeholder", () => {
  beforeEach(() => list.mockReset());

  it("keeps the rows shown while a narrower search of the same contacts loads", async () => {
    list.mockResolvedValueOnce(page("active")).mockImplementationOnce(never);
    const { result, rerender } = setup({ sort: "name" });
    await waitFor(() => expect(shown(result.current.data)).toEqual(["active"]));
    rerender({ query: { sort: "name", search: "a" } });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(shown(result.current.data)).toEqual(["active"]);
  });

  it("never shows live contacts as archived, or archived as live, while the other loads", async () => {
    list
      .mockResolvedValueOnce(page("active"))
      .mockImplementationOnce(never)
      .mockResolvedValueOnce(page("archived"))
      .mockImplementationOnce(never);
    const { result, rerender } = setup({ sort: "name" });
    await waitFor(() => expect(shown(result.current.data)).toEqual(["active"]));
    rerender({ query: { sort: "name", archived: "true" } });
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();

    // A fresh client for the reverse direction: archived rows loaded first.
    const reverse = setup({ sort: "name", archived: "true" });
    await waitFor(() =>
      expect(shown(reverse.result.current.data)).toEqual(["archived"]),
    );
    reverse.rerender({ query: { sort: "name" } });
    expect(reverse.result.current.data).toBeUndefined();
  });
});
