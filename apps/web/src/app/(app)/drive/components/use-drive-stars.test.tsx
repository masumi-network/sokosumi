import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const getDriveStars = vi.hoisted(() => vi.fn());
vi.mock("@sokosumi/core-client", () => ({
  getDriveStars,
  putDriveStars: vi.fn(),
}));
vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

import { useDriveStars } from "./use-drive-stars";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe("useDriveStars", () => {
  it("knows a starred folder however its path is written", async () => {
    getDriveStars.mockResolvedValue({
      data: {
        data: {
          folders: [{ path: "Finance/Board", name: "Board" }],
          files: [],
        },
      },
    });

    const { result } = renderHook(() => useDriveStars({ scope: "me" }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.stars).toBeDefined());
    expect(result.current.isFolderStarred("Finance/Board")).toBe(true);
    expect(result.current.isFolderStarred("/Finance/Board/")).toBe(true);
    expect(result.current.isFolderStarred("Finance")).toBe(false);
  });
});
