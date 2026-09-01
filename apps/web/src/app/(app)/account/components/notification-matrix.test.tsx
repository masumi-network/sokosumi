import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyPreferencesQueryKey } from "@/queries/preferences";

import { NotificationMatrix } from "./notification-matrix";

const patchMyPreferences = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { user: { id: "user_1" } } }),
}));

vi.mock("@/lib/clients/core.preferences.browser.client", () => ({
  preferencesBrowserClient: {
    getMyPreferences: vi.fn(),
    patchMyPreferences: (body: unknown) => patchMyPreferences(body),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const MATRIX = [
  { category: "JOB", channel: "IN_APP", enabled: true },
  { category: "JOB", channel: "OS_BANNER", enabled: true },
  { category: "CHAT_MENTION", channel: "IN_APP", enabled: true },
  { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
];

function renderMatrix(notificationPreferences = MATRIX) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(getMyPreferencesQueryKey("user_1"), {
    data: {
      marketingOptIn: true,
      notificationsOptIn: true,
      pushOptIn: true,
      notificationPreferences,
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <NotificationMatrix />
    </QueryClientProvider>,
  );

  return queryClient;
}

/** Translations are mocked to the key, so the aria-label is key plus values. */
const cellSwitch = (category: string, channel: string) =>
  screen.getByRole("switch", {
    name: `matrixCellAriaLabel ${category} ${channel}`,
  });

describe("NotificationMatrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchMyPreferences.mockResolvedValue({
      data: {
        marketingOptIn: true,
        notificationsOptIn: true,
        pushOptIn: true,
        notificationPreferences: MATRIX,
      },
    });
  });

  it("shows one switch per cell, set to the reader's answer", () => {
    renderMatrix();

    expect(cellSwitch("matrixCategoryJob", "matrixChannelInApp")).toBeChecked();
    expect(
      cellSwitch("matrixCategoryChatMention", "matrixChannelOsBanner"),
    ).not.toBeChecked();
  });

  it("writes only the cell the reader changed", async () => {
    renderMatrix();

    await userEvent.click(
      cellSwitch("matrixCategoryChatMention", "matrixChannelInApp"),
    );

    expect(patchMyPreferences).toHaveBeenCalledWith({
      notificationPreferences: [
        { category: "CHAT_MENTION", channel: "IN_APP", enabled: false },
      ],
    });
  });

  /** A switch that waits for the round trip reads as broken. */
  it("paints the change before the write lands", async () => {
    let resolveWrite: (value: unknown) => void = () => {};
    patchMyPreferences.mockReturnValue(
      new Promise((resolve) => {
        resolveWrite = resolve;
      }),
    );
    renderMatrix();

    await userEvent.click(
      cellSwitch("matrixCategoryJob", "matrixChannelInApp"),
    );

    expect(
      cellSwitch("matrixCategoryJob", "matrixChannelInApp"),
    ).not.toBeChecked();

    resolveWrite({
      data: {
        marketingOptIn: true,
        notificationsOptIn: true,
        pushOptIn: true,
        notificationPreferences: MATRIX,
      },
    });
  });

  it("puts the switch back when the write fails", async () => {
    patchMyPreferences.mockRejectedValue(new Error("core down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderMatrix();

    await userEvent.click(
      cellSwitch("matrixCategoryJob", "matrixChannelInApp"),
    );

    await vi.waitFor(() => {
      expect(
        cellSwitch("matrixCategoryJob", "matrixChannelInApp"),
      ).toBeChecked();
    });
  });

  /**
   * Two switches in flight at once. A rollback that restored a whole snapshot
   * would take the other cell's change down with the failed one. Both writes
   * are left pending, so what stands on screen is the painting alone.
   */
  it("keeps another cell's change when this one fails", async () => {
    let failFirst: (reason: unknown) => void = () => {};
    patchMyPreferences.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failFirst = reject;
      }),
    );
    patchMyPreferences.mockReturnValueOnce(new Promise(() => {}));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderMatrix();

    await userEvent.click(
      cellSwitch("matrixCategoryJob", "matrixChannelInApp"),
    );
    await userEvent.click(
      cellSwitch("matrixCategoryChatMention", "matrixChannelOsBanner"),
    );

    failFirst(new Error("core down"));

    await vi.waitFor(() => {
      expect(
        cellSwitch("matrixCategoryJob", "matrixChannelInApp"),
      ).toBeChecked();
    });
    expect(
      cellSwitch("matrixCategoryChatMention", "matrixChannelOsBanner"),
    ).toBeChecked();
  });

  /** Nothing to render before the preferences land, and no empty table either. */
  it("renders nothing until the matrix arrives", () => {
    renderMatrix([]);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
