import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UsersnapProvider } from "@/components/usersnap/usersnap-provider";
import { useUsersnapApi } from "@/components/usersnap/useUsersnapAPI";

const loadSpaceMock = vi.fn();
const consoleWarnMock = vi.fn();
const consoleErrorMock = vi.fn();

vi.mock("@usersnap/browser", () => ({
  loadSpace: (...args: unknown[]) => loadSpaceMock(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    useSession: () => ({ data: null }),
  },
}));

function UsersnapConsumer() {
  const api = useUsersnapApi();
  return <div data-testid="usersnap-ready">{api ? "ready" : "idle"}</div>;
}

describe("UsersnapProvider", () => {
  beforeEach(() => {
    loadSpaceMock.mockReset();
    consoleWarnMock.mockReset();
    consoleErrorMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(consoleWarnMock);
    vi.spyOn(console, "error").mockImplementation(consoleErrorMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles Usersnap widget load failures without leaving the API unset", async () => {
    loadSpaceMock.mockRejectedValue(
      "Failed to load the widget: Wrong API key or paused project",
    );

    render(
      <UsersnapProvider usersnapSpaceApiKey="invalid-key">
        <UsersnapConsumer />
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(consoleWarnMock).toHaveBeenCalledWith(
        "Usersnap widget failed to load:",
        "Failed to load the widget: Wrong API key or paused project",
      );
    });

    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it("initializes Usersnap when loadSpace succeeds", async () => {
    const initMock = vi.fn();
    loadSpaceMock.mockResolvedValue({ init: initMock });

    render(
      <UsersnapProvider usersnapSpaceApiKey="valid-key">
        <UsersnapConsumer />
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(initMock).toHaveBeenCalledWith({});
    });
  });
});
