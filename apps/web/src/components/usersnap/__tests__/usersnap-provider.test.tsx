import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UsersnapProvider } from "../usersnap-provider";
import { useUsersnapApi } from "../useUsersnapAPI";

const loadSpaceMock = vi.fn();

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
  return <div data-testid="usersnap-ready">{api ? "ready" : "pending"}</div>;
}

describe("UsersnapProvider", () => {
  it("handles Usersnap load failures without leaving the API ready", async () => {
    const usersnapError =
      "Failed to load the widget: Wrong API key or paused project";
    loadSpaceMock.mockRejectedValueOnce(usersnapError);

    const rejectionHandler = vi.fn();
    window.addEventListener("unhandledrejection", rejectionHandler);

    render(
      <UsersnapProvider usersnapSpaceApiKey="invalid-key">
        <UsersnapConsumer />
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(loadSpaceMock).toHaveBeenCalledWith("invalid-key");
    });

    expect(screen.getByTestId("usersnap-ready")).toHaveTextContent("pending");
    expect(rejectionHandler).not.toHaveBeenCalled();

    window.removeEventListener("unhandledrejection", rejectionHandler);
  });

  it("initializes Usersnap when loadSpace succeeds", async () => {
    const initMock = vi.fn();
    loadSpaceMock.mockResolvedValueOnce({ init: initMock });

    render(
      <UsersnapProvider usersnapSpaceApiKey="valid-key">
        <UsersnapConsumer />
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("usersnap-ready")).toHaveTextContent("ready");
    });

    expect(initMock).toHaveBeenCalledWith({});
  });
});
