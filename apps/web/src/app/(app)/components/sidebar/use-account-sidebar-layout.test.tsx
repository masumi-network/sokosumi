import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { getMyPreferencesQueryKey } from "@/queries/preferences";
import { useAccountSidebarLayout } from "./use-account-sidebar-layout";

const api = vi.hoisted(() => ({
  getMyPreferences: vi.fn(),
  patchMyPreferences: vi.fn(),
}));
vi.mock("@/lib/clients/core.preferences.browser.client", () => ({
  preferencesBrowserClient: api,
}));

it("keeps a confirmed first visit when an older preference read finishes later", async () => {
  const userId = "reader";
  const key = getMyPreferencesQueryKey(userId);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const original = { data: { sidebarLayout: null, sidebarSeenItems: [] } };
  client.setQueryData(key, original);
  const pendingRead = Promise.withResolvers<typeof original>();
  const startedRead = Promise.withResolvers<void>();
  api.getMyPreferences.mockImplementation(() => {
    startedRead.resolve();
    return pendingRead.promise;
  });
  api.patchMyPreferences.mockResolvedValue({
    data: { sidebarLayout: null, sidebarSeenItems: ["new-page"] },
  });
  const { result } = renderHook(() => useAccountSidebarLayout(userId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider
        locale="en"
        messages={{ App: { Sidebar: { Layout: {} } } }}
        timeZone="UTC"
      >
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    ),
  });
  expect(result.current.isUnseen("social")).toBe(false);
  expect(result.current.isUnseen("new-page")).toBe(true);
  const read = client.refetchQueries({ queryKey: key });
  await startedRead.promise;
  act(() => result.current.markSeen("new-page"));
  await waitFor(() => expect(result.current.isUnseen("new-page")).toBe(false));
  await act(async () => {
    pendingRead.resolve(original);
    await read;
  });
  expect(client.getQueryData(key)).toMatchObject({
    data: { sidebarSeenItems: ["new-page"] },
  });
});
