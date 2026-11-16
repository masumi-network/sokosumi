import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { seoTestWorkspace } from "./seo-test-fixture";
import { useSeoChat } from "./use-seo-chat";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: null }, user: { id: "owner" } },
  }),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe("SEO chat billing retry", () => {
  it.each([422, "network"] as const)(
    "uses the correct attempt key after %s",
    async (failure) => {
      const keys: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, options?: RequestInit) => {
          if (options?.method === "POST") {
            keys.push(JSON.parse(String(options.body)).idempotencyKey);
            if (failure === "network")
              throw new Error("Connection lost after send");
            return new Response("{}", { status: 422 });
          }
          return Response.json({ sharing: "personal", turns: [] });
        }),
      );
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      clients.push(client);
      const model = {
        data: { ...seoTestWorkspace(), auditId: "audit" },
        chatOpen: true,
        filters: {},
      } as SeoWorkspaceModel;
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <NextIntlClientProvider
            locale="en"
            timeZone="UTC"
            messages={messages}
          >
            {children}
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
      const { result } = renderHook(() => useSeoChat(model), { wrapper });
      await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
      act(() => result.current.setQuestion("What should I fix?"));
      await act(async () => {
        await result.current.send();
      });
      expect(result.current.question).toBe("What should I fix?");
      if (failure === 422)
        expect(result.current.error).toContain("Not enough credits");
      await act(async () => {
        await result.current.send();
      });
      expect(keys).toHaveLength(2);
      if (failure === 422) expect(keys[1]).not.toBe(keys[0]);
      else expect(keys[1]).toBe(keys[0]);
    },
  );
});
