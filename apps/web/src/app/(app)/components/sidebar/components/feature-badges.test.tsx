import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameRef, markSeenMock } = vi.hoisted(() => ({
  pathnameRef: { current: "/tasks" },
  markSeenMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/actions/badge-campaign/action", () => ({
  markBadgeCampaignSeenAction: markSeenMock,
}));

import {
  type BadgeCampaignSummary,
  FeatureBadgesProvider,
  useMarkFeatureSeen,
} from "./feature-badges";
import { SidebarFeatureLabel } from "./sidebar-feature-label";

const DRIVE_CAMPAIGN: BadgeCampaignSummary = {
  id: "campaign-drive",
  feature: "DRIVE",
  endsAt: new Date("2026-10-22T00:00:00.000Z"),
};

/**
 * React only reads a promise's value synchronously once it has been tagged
 * as fulfilled; a settled one tagged up front lets `use()` skip the suspend
 * round trip, so each test sees the settled sidebar on first render.
 */
function settled<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), {
    status: "fulfilled",
    value,
  });
}

let queryClient: QueryClient;
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

async function renderRows(campaigns: BadgeCampaignSummary[]) {
  const view = render(
    <FeatureBadgesProvider userId="user_123" campaigns={settled(campaigns)}>
      <span data-testid="drive">
        <SidebarFeatureLabel label="Drive" feature="DRIVE" />
      </span>
      <span data-testid="studio">
        <SidebarFeatureLabel label="Content Studio" feature="CONTENT_STUDIO" />
      </span>
    </FeatureBadgesProvider>,
    { wrapper: Wrapper },
  );
  // Let the campaigns promise settle and the suspended pills render.
  await act(async () => {});
  return view;
}

describe("New badges in the sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
      ],
    });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              data: { badgeCampaigns: [] },
              meta: { timestamp: "2026-10-01T12:00:00Z" },
            }),
          ),
      ),
    );
    markSeenMock.mockResolvedValue({ ok: true, value: undefined });
    pathnameRef.current = "/tasks";
  });

  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("removes the pill at the campaign's end without navigating", async () => {
    await renderRows([
      { ...DRIVE_CAMPAIGN, endsAt: new Date("2026-10-01T12:00:01Z") },
    ]);
    expect(screen.getByTestId("drive")).toHaveTextContent("Drivenew");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(screen.getByTestId("drive")).toHaveTextContent(/^Drive$/);
  });

  it("retries a failed seen write while keeping the pill hidden", async () => {
    markSeenMock.mockResolvedValueOnce({
      ok: false,
      error: { message: "Unavailable" },
    });
    pathnameRef.current = "/drive";
    await renderRows([DRIVE_CAMPAIGN]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(markSeenMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("drive")).toHaveTextContent(/^Drive$/);
  });

  it("catches transport rejection and retries persistence", async () => {
    markSeenMock.mockRejectedValueOnce(new Error("offline"));
    pathnameRef.current = "/drive";
    await renderRows([DRIVE_CAMPAIGN]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(markSeenMock).toHaveBeenCalledTimes(2);
  });

  it("persists a visit after prolonged failure even when the reader navigates away", async () => {
    markSeenMock.mockResolvedValue({
      ok: false,
      error: { message: "offline" },
    });
    pathnameRef.current = "/drive";
    const view = await renderRows([DRIVE_CAMPAIGN]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_010);
    });
    expect(markSeenMock).toHaveBeenCalledTimes(4);
    pathnameRef.current = "/tasks";
    markSeenMock.mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: { badgeCampaigns: [DRIVE_CAMPAIGN] },
            meta: { timestamp: "2026-10-01T12:00:00Z" },
          }),
        ),
    );
    view.rerender(
      <FeatureBadgesProvider
        userId="user_123"
        campaigns={settled([DRIVE_CAMPAIGN])}
      >
        <SidebarFeatureLabel label="Drive" feature="DRIVE" />
      </FeatureBadgesProvider>,
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["badge-campaigns", "user_123"],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(markSeenMock).toHaveBeenCalledTimes(5);
  });

  it("stops queued seen retries when the account leaves the layout", async () => {
    markSeenMock.mockRejectedValueOnce(new Error("offline"));
    pathnameRef.current = "/drive";
    const view = await renderRows([DRIVE_CAMPAIGN]);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(markSeenMock).toHaveBeenCalledTimes(1);
  });

  it("discovers a later campaign while the layout stays mounted", async () => {
    await renderRows([]);
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              badgeCampaigns: [{ ...DRIVE_CAMPAIGN, id: "later-drive" }],
            },
            meta: { timestamp: "2026-10-01T12:00:00Z" },
          }),
        ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("drive")).toHaveTextContent("Drivenew");
    pathnameRef.current = "/drive/deep/folder";
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["badge-campaigns", "user_123"],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(markSeenMock).toHaveBeenCalledWith("later-drive");
  });

  it("keeps navigation available while the campaigns promise waits", async () => {
    const pending = new Promise<BadgeCampaignSummary[]>(() => {});
    render(
      <FeatureBadgesProvider userId="user_123" campaigns={pending}>
        <SidebarFeatureLabel label="Drive" feature="DRIVE" />
      </FeatureBadgesProvider>,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("Drive")).toBeVisible();
    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it("clears stale pills when the background read fails", async () => {
    await renderRows([DRIVE_CAMPAIGN]);
    vi.mocked(fetch).mockImplementation(
      async () => new Response(null, { status: 502 }),
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["badge-campaigns", "user_123"],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("drive")).toHaveTextContent(/^Drive$/);
  });

  it("shows the pill only on rows with a running campaign", async () => {
    await renderRows([DRIVE_CAMPAIGN]);

    expect(screen.getByTestId("drive")).toHaveTextContent("Drivenew");
    expect(screen.getByTestId("studio")).toHaveTextContent(/^Content Studio$/);
    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it("marks the campaign seen and drops the pill once the reader opens the feature", async () => {
    const view = await renderRows([DRIVE_CAMPAIGN]);

    pathnameRef.current = "/drive/folder-1";
    view.rerender(
      <FeatureBadgesProvider
        userId="user_123"
        campaigns={settled([DRIVE_CAMPAIGN])}
      >
        <span data-testid="drive">
          <SidebarFeatureLabel label="Drive" feature="DRIVE" />
        </span>
      </FeatureBadgesProvider>,
    );
    await act(async () => {});

    expect(markSeenMock).toHaveBeenCalledTimes(1);
    expect(markSeenMock).toHaveBeenCalledWith("campaign-drive");
    expect(screen.getByTestId("drive")).toHaveTextContent(/^Drive$/);
  });

  it("marks seen on first load when the reader lands on the feature", async () => {
    pathnameRef.current = "/drive";

    await renderRows([DRIVE_CAMPAIGN]);

    expect(markSeenMock).toHaveBeenCalledWith("campaign-drive");
    expect(screen.getByTestId("drive")).toHaveTextContent(/^Drive$/);
  });

  it("does not match a path that only shares a prefix", async () => {
    pathnameRef.current = "/drivers";

    await renderRows([DRIVE_CAMPAIGN]);

    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it("shows no pill outside the provider", () => {
    render(<SidebarFeatureLabel label="Drive" feature="DRIVE" />);

    expect(screen.queryByText("new")).toBeNull();
  });

  it("marks an action feature seen when the reader uses it", async () => {
    function SearchRow() {
      const markFeatureSeen = useMarkFeatureSeen();
      return (
        <button type="button" onClick={() => markFeatureSeen("SEARCH")}>
          <SidebarFeatureLabel label="Search" feature="SEARCH" />
        </button>
      );
    }
    render(
      <FeatureBadgesProvider
        userId="user_123"
        campaigns={settled([
          {
            id: "campaign-search",
            feature: "SEARCH",
            endsAt: DRIVE_CAMPAIGN.endsAt,
          },
        ])}
      >
        <SearchRow />
      </FeatureBadgesProvider>,
      { wrapper: Wrapper },
    );
    await act(async () => {});
    expect(screen.getByRole("button")).toHaveTextContent("Searchnew");

    await act(async () => {
      screen.getByRole("button").click();
    });

    expect(markSeenMock).toHaveBeenCalledWith("campaign-search");
    expect(screen.getByRole("button")).toHaveTextContent(/^Search$/);
  });
});
