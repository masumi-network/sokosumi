import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
} from "./feature-badges";
import { SidebarLabelWithNew } from "./sidebar-new-badge";

const DRIVE_CAMPAIGN: BadgeCampaignSummary = {
  id: "campaign-drive",
  feature: "DRIVE",
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

async function renderRows(campaigns: BadgeCampaignSummary[]) {
  const view = render(
    <FeatureBadgesProvider campaigns={settled(campaigns)}>
      <span data-testid="drive">
        <SidebarLabelWithNew label="Drive" feature="DRIVE" />
      </span>
      <span data-testid="studio">
        <SidebarLabelWithNew label="Content Studio" feature="CONTENT_STUDIO" />
      </span>
    </FeatureBadgesProvider>,
  );
  // Let the campaigns promise settle and the suspended pills render.
  await act(async () => {});
  return view;
}

describe("New badges in the sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markSeenMock.mockResolvedValue({ ok: true, value: undefined });
    pathnameRef.current = "/tasks";
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
      <FeatureBadgesProvider campaigns={settled([DRIVE_CAMPAIGN])}>
        <span data-testid="drive">
          <SidebarLabelWithNew label="Drive" feature="DRIVE" />
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
    render(<SidebarLabelWithNew label="Drive" feature="DRIVE" />);

    expect(screen.queryByText("new")).toBeNull();
  });
});
