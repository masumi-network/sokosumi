import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyPreferencesQueryKey } from "@/queries/preferences";

import { NotificationKinds } from "./notification-kinds";

const patchMyPreferences = vi.fn();
const setAccountEnabled = vi.fn();
let isAccountEnabled = true;

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

vi.mock("@/lib/ably/use-push-preference", () => ({
  usePushPreference: () => ({
    isAccountEnabled,
    isDeviceEnabled: false,
    isSupported: true,
    isBlocked: false,
    canToggleAccount: true,
    canToggleDevice: true,
    isSaving: false,
    setAccountEnabled,
    setDeviceEnabled: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

/** Chat's two kinds disagree, so the group has a mixture to report. */
const MATRIX = [
  { category: "JOB", channel: "IN_APP", enabled: true },
  { category: "JOB", channel: "OS_BANNER", enabled: true },
  { category: "TASK", channel: "IN_APP", enabled: true },
  { category: "TASK", channel: "OS_BANNER", enabled: false },
  { category: "CHAT_MENTION", channel: "IN_APP", enabled: true },
  { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
  { category: "CHAT_DIRECT_MESSAGE", channel: "IN_APP", enabled: true },
  { category: "CHAT_DIRECT_MESSAGE", channel: "OS_BANNER", enabled: true },
  { category: "SYSTEM", channel: "IN_APP", enabled: true },
  { category: "SYSTEM", channel: "OS_BANNER", enabled: false },
];

/** The stored matrix as the fake Core holds it, so a write can be read back. */
let current: typeof MATRIX = MATRIX;

function response(notificationPreferences = current) {
  return {
    data: {
      marketingOptIn: true,
      notificationsOptIn: true,
      pushOptIn: isAccountEnabled,
      notificationPreferences,
    },
  };
}

function renderKinds(notificationPreferences = MATRIX) {
  current = notificationPreferences;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(getMyPreferencesQueryKey("user_1"), response());

  render(
    <QueryClientProvider client={queryClient}>
      <NotificationKinds />
    </QueryClientProvider>,
  );
}

function lastWrite() {
  const calls = patchMyPreferences.mock.calls;
  return calls[calls.length - 1][0].notificationPreferences;
}

function written(category: string, channel: string) {
  return lastWrite().find(
    (cell: { category: string; channel: string }) =>
      cell.category === category && cell.channel === channel,
  )?.enabled;
}

/** Translations are mocked to the key, so the aria-label is key plus values. */
function stops(kind: string) {
  return screen.getByRole("group", { name: `deliveryAriaLabel ${kind}` });
}

function stop(kind: string, delivery: string) {
  return within(stops(kind)).getByRole("button", { name: delivery });
}

async function pick(kind: string, delivery: string) {
  const user = userEvent.setup();
  await user.click(stop(kind, delivery));
}

describe("NotificationKinds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAccountEnabled = true;
    current = MATRIX;
    // Echoing the write back matters: a mock that always answers with the
    // original matrix would undo every optimistic paint, and a control that
    // never settles would look identical to one that writes nothing.
    patchMyPreferences.mockImplementation(
      (body: { notificationPreferences: typeof MATRIX }) => {
        current = current.map((cell) => {
          const next = body.notificationPreferences.find(
            (candidate) =>
              candidate.category === cell.category &&
              candidate.channel === cell.channel,
          );

          return next ? { ...cell, enabled: next.enabled } : cell;
        });

        return Promise.resolve(response());
      },
    );
    setAccountEnabled.mockResolvedValue(true);
  });

  it("marks where each kind arrives, without opening anything", () => {
    renderKinds();

    expect(stop("kindJob", "deliveryBanner")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(stop("kindTask", "deliveryInApp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(stop("kindTask", "deliveryBanner")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Chat holds two kinds that disagree, and says so rather than picking one.
    expect(stop("groupChat", "deliveryMixed")).toBeInTheDocument();
  });

  it("opens the group from the mixture rather than resolving it", async () => {
    const user = userEvent.setup();
    renderKinds();

    expect(screen.queryByText("kindChatMention")).toBeNull();
    await user.click(stop("groupChat", "deliveryMixed"));

    expect(screen.getByText("kindChatMention")).toBeInTheDocument();
    expect(patchMyPreferences).not.toHaveBeenCalled();
  });

  it("writes both channels of the kind the reader changed", async () => {
    renderKinds();

    await pick("kindJob", "deliveryOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(2);
    expect(written("JOB", "IN_APP")).toBe(false);
    expect(written("JOB", "OS_BANNER")).toBe(false);
    expect(stop("kindJob", "deliveryOff")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("turns a banner into both channels, so nothing arrives unseen", async () => {
    renderKinds();

    await pick("kindTask", "deliveryBanner");

    await waitFor(() => {
      expect(written("TASK", "OS_BANNER")).toBe(true);
    });
    expect(written("TASK", "IN_APP")).toBe(true);
  });

  it("sets every kind in a group from the group's own control", async () => {
    renderKinds();

    await pick("groupChat", "deliveryOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    // One request, so the group cannot end up half applied with the reader
    // watching its kinds settle one by one.
    expect(lastWrite()).toHaveLength(4);
    expect(written("CHAT_MENTION", "IN_APP")).toBe(false);
    expect(written("CHAT_DIRECT_MESSAGE", "OS_BANNER")).toBe(false);
  });

  it("keeps the kinds in a group separately selectable", async () => {
    const user = userEvent.setup();
    renderKinds();

    await user.click(screen.getByRole("button", { name: /^groupChat/ }));
    await pick("kindChatDirectMessage", "deliveryOff");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(lastWrite()).toHaveLength(2);
    expect(written("CHAT_DIRECT_MESSAGE", "IN_APP")).toBe(false);
    expect(written("CHAT_MENTION", "IN_APP")).toBeUndefined();
  });

  it("turns push on from the control that asked for a banner", async () => {
    isAccountEnabled = false;
    renderKinds();

    await pick("kindTask", "deliveryBanner");

    await waitFor(() => {
      expect(setAccountEnabled).toHaveBeenCalledWith(true);
    });
  });

  it("does not ask for push when the banner it writes was already on", async () => {
    isAccountEnabled = false;
    // Both chat kinds already banner, and one of them missing its in-app cell,
    // so the group write changes something without asking for a new banner.
    renderKinds(
      MATRIX.map((cell) =>
        cell.category === "CHAT_MENTION"
          ? { ...cell, enabled: cell.channel === "OS_BANNER" }
          : cell,
      ),
    );

    await pick("groupChat", "deliveryBanner");

    await waitFor(() => {
      expect(patchMyPreferences).toHaveBeenCalledTimes(1);
    });
    expect(written("CHAT_MENTION", "IN_APP")).toBe(true);
    expect(setAccountEnabled).not.toHaveBeenCalled();
  });

  it("puts the row back when the write fails", async () => {
    patchMyPreferences.mockRejectedValueOnce(new Error("nope"));
    renderKinds();

    await pick("kindJob", "deliveryOff");

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(stop("kindJob", "deliveryBanner")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("draws nothing for a kind Core does not send", () => {
    renderKinds(MATRIX.filter((cell) => cell.category !== "SYSTEM"));

    expect(
      screen.queryByRole("group", { name: "deliveryAriaLabel kindSystem" }),
    ).toBeNull();
    expect(stops("kindJob")).toBeInTheDocument();
  });
});
