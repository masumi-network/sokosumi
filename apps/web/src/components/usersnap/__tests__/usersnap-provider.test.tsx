import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersnapProvider } from "../usersnap-provider";

const loadSpaceMock = vi.fn();
const initMock = vi.fn();

vi.mock("@usersnap/browser", () => ({
  loadSpace: (...args: unknown[]) => loadSpaceMock(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    useSession: () => ({ data: null }),
  },
}));

describe("UsersnapProvider", () => {
  beforeEach(() => {
    loadSpaceMock.mockReset();
    initMock.mockReset();
  });

  it("handles loadSpace rejection without throwing", async () => {
    const widgetError =
      "Failed to load the widget: Wrong API key or paused project";
    loadSpaceMock.mockRejectedValue(widgetError);

    expect(() => {
      render(
        <UsersnapProvider usersnapSpaceApiKey="invalid-key">
          <span>child</span>
        </UsersnapProvider>,
      );
    }).not.toThrow();

    await waitFor(() => {
      expect(loadSpaceMock).toHaveBeenCalledWith("invalid-key");
    });
  });

  it("initializes Usersnap when loadSpace succeeds", async () => {
    loadSpaceMock.mockResolvedValue({ init: initMock });

    render(
      <UsersnapProvider usersnapSpaceApiKey="valid-key">
        <span>child</span>
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(loadSpaceMock).toHaveBeenCalledWith("valid-key");
      expect(initMock).toHaveBeenCalledWith({});
    });
  });

  it("does not call loadSpace when API key is missing", () => {
    render(
      <UsersnapProvider>
        <span>child</span>
      </UsersnapProvider>,
    );

    expect(loadSpaceMock).not.toHaveBeenCalled();
  });
});
