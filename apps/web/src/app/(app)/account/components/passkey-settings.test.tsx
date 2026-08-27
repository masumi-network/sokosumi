import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasskeySettings } from "./passkey-settings";

const mockAddPasskey = vi.fn();
const mockDeletePasskey = vi.fn();
const mockListUserPasskeys = vi.fn();
const mockRefresh = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
const mockUpdatePasskey = vi.fn();
let currentPasskeys: Array<{
  createdAt: string;
  id: string;
  name: string;
}> = [];

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace?: string) => {
    return (
      key: string,
      values?: {
        date?: string;
        name?: string;
      },
    ) => {
      if (key === "createdAt") {
        return `created-${values?.date}`;
      }

      if (key === "deleteAriaLabel") {
        return `delete-${values?.name}`;
      }

      if (key === "editAriaLabel") {
        return `edit-${values?.name}`;
      }

      return key;
    };
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    passkey: {
      addPasskey: (...args: unknown[]) => mockAddPasskey(...args),
      deletePasskey: (...args: unknown[]) => mockDeletePasskey(...args),
      listUserPasskeys: (...args: unknown[]) => mockListUserPasskeys(...args),
      updatePasskey: (...args: unknown[]) => mockUpdatePasskey(...args),
    },
  },
}));

describe("PasskeySettings", () => {
  beforeEach(() => {
    mockAddPasskey.mockReset();
    mockAddPasskey.mockResolvedValue({
      data: {
        id: "passkey-2",
      },
      error: null,
    });
    mockDeletePasskey.mockReset();
    mockDeletePasskey.mockResolvedValue({
      data: {
        status: true,
      },
      error: null,
    });
    mockUpdatePasskey.mockReset();
    mockUpdatePasskey.mockResolvedValue({
      data: {
        passkey: {
          id: "passkey-1",
          name: "Renamed passkey",
        },
      },
      error: null,
    });
    currentPasskeys = [
      {
        createdAt: "2026-03-13T10:00:00.000Z",
        id: "passkey-1",
        name: "MacBook Touch ID",
      },
    ];
    mockListUserPasskeys.mockReset();
    mockListUserPasskeys.mockImplementation(async () => ({
      data: currentPasskeys,
      error: null,
    }));
    mockRefresh.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
  });

  it("renders the user passkeys", async () => {
    render(<PasskeySettings />);

    expect(mockListUserPasskeys).toHaveBeenCalled();

    expect(await screen.findByText("MacBook Touch ID")).toBeInTheDocument();
    expect(screen.getByText(/created-/)).toBeInTheDocument();
  });

  it("disables the add button while the initial passkey load is in progress", async () => {
    const pendingListPasskeys = createDeferred<{
      data: typeof currentPasskeys;
      error: null;
    }>();

    mockListUserPasskeys.mockImplementationOnce(
      () => pendingListPasskeys.promise,
    );

    render(<PasskeySettings />);

    expect(screen.getByRole("button", { name: "add" })).toBeDisabled();
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(mockAddPasskey).not.toHaveBeenCalled();

    pendingListPasskeys.resolve({
      data: currentPasskeys,
      error: null,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "add" })).not.toBeDisabled();
    });
  });

  it("adds a passkey and refreshes the list", async () => {
    const user = userEvent.setup();

    render(<PasskeySettings />);

    await user.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() => {
      expect(mockAddPasskey).toHaveBeenCalledWith();
    });

    await waitFor(() => {
      expect(mockListUserPasskeys.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("addSuccess");
  });

  it("disables row actions while adding a passkey", async () => {
    const user = userEvent.setup();
    const pendingAdd = createDeferred<{
      data: {
        id: string;
      };
      error: null;
    }>();

    mockAddPasskey.mockImplementationOnce(() => pendingAdd.promise);

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "edit-MacBook Touch ID" });
    await user.click(screen.getByRole("button", { name: "add" }));

    expect(screen.getByRole("button", { name: "add" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "edit-MacBook Touch ID" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "delete-MacBook Touch ID" }),
    ).toBeDisabled();

    pendingAdd.resolve({
      data: {
        id: "passkey-2",
      },
      error: null,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "add" })).not.toBeDisabled();
    });
  });

  it("deletes a passkey and refreshes the list", async () => {
    const user = userEvent.setup();

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "delete-MacBook Touch ID" });

    await user.click(
      screen.getByRole("button", { name: "delete-MacBook Touch ID" }),
    );

    await waitFor(() => {
      expect(mockDeletePasskey).toHaveBeenCalledWith({
        id: "passkey-1",
      });
    });

    await waitFor(() => {
      expect(mockListUserPasskeys.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("deleteSuccess");
  });

  it("disables the add button while deleting a passkey", async () => {
    const user = userEvent.setup();
    const pendingDelete = createDeferred<{
      data: {
        status: boolean;
      };
      error: null;
    }>();

    mockDeletePasskey.mockImplementationOnce(() => pendingDelete.promise);

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "delete-MacBook Touch ID" });
    await user.click(
      screen.getByRole("button", { name: "delete-MacBook Touch ID" }),
    );

    expect(screen.getByRole("button", { name: "add" })).toBeDisabled();

    pendingDelete.resolve({
      data: {
        status: true,
      },
      error: null,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "add" })).not.toBeDisabled();
    });
  });

  it("shows an error when passkey registration fails", async () => {
    const user = userEvent.setup();
    mockAddPasskey.mockResolvedValueOnce({
      data: null,
      error: {
        code: "FAILED",
        message: "passkey provider not available",
      },
    });

    render(<PasskeySettings />);

    await user.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "addError: passkey provider not available",
      );
    });
  });

  it("resets the add button when passkey registration throws", async () => {
    const user = userEvent.setup();
    mockAddPasskey.mockRejectedValueOnce(new Error("network down"));

    render(<PasskeySettings />);

    await user.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("addError");
    });

    expect(screen.getByRole("button", { name: "add" })).not.toBeDisabled();
  });

  it("shows a refresh error instead of success when reloading after add fails", async () => {
    const user = userEvent.setup();
    mockListUserPasskeys.mockResolvedValueOnce({
      data: currentPasskeys,
      error: null,
    });
    mockListUserPasskeys.mockResolvedValueOnce({
      data: null,
      error: {
        code: "FAILED",
        message: "list failed",
      },
    });

    render(<PasskeySettings />);

    await screen.findByText("MacBook Touch ID");
    await user.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("refreshError");
    });

    expect(mockToastSuccess).not.toHaveBeenCalledWith("addSuccess");
    expect(screen.getByText("loadError")).toBeInTheDocument();
  });

  it("shows an error when passkey deletion fails", async () => {
    const user = userEvent.setup();
    mockDeletePasskey.mockResolvedValueOnce({
      data: null,
      error: {
        code: "FAILED",
      },
    });

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "delete-MacBook Touch ID" });

    await user.click(
      screen.getByRole("button", { name: "delete-MacBook Touch ID" }),
    );

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("deleteError");
    });
  });

  it("enters edit mode with the current passkey name", async () => {
    const user = userEvent.setup();

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "edit-MacBook Touch ID" });
    await user.click(
      screen.getByRole("button", { name: "edit-MacBook Touch ID" }),
    );

    expect(screen.getByDisplayValue("MacBook Touch ID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cancel" })).toBeInTheDocument();
  });

  it("saves a renamed passkey and refreshes the list", async () => {
    const user = userEvent.setup();

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "edit-MacBook Touch ID" });
    await user.click(
      screen.getByRole("button", { name: "edit-MacBook Touch ID" }),
    );

    const input = screen.getByRole("textbox", { name: "editInputLabel" });

    await user.clear(input);
    await user.type(input, "Laptop passkey");
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(mockUpdatePasskey).toHaveBeenCalledWith({
        id: "passkey-1",
        name: "Laptop passkey",
      });
    });

    await waitFor(() => {
      expect(mockListUserPasskeys.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("renameSuccess");
  });

  it("saves a renamed passkey when the user presses Enter", async () => {
    const user = userEvent.setup();

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "edit-MacBook Touch ID" });
    await user.click(
      screen.getByRole("button", { name: "edit-MacBook Touch ID" }),
    );

    const input = screen.getByRole("textbox", { name: "editInputLabel" });

    await user.clear(input);
    await user.type(input, "Laptop passkey{enter}");

    await waitFor(() => {
      expect(mockUpdatePasskey).toHaveBeenCalledWith({
        id: "passkey-1",
        name: "Laptop passkey",
      });
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("renameSuccess");
  });

  it("saves an empty edited name and falls back to the default label", async () => {
    const user = userEvent.setup();
    mockUpdatePasskey.mockImplementationOnce(
      async ({ id, name }: { id: string; name: string }) => {
        currentPasskeys = currentPasskeys.map((passkey) =>
          passkey.id === id
            ? {
                ...passkey,
                name,
              }
            : passkey,
        );

        return {
          data: {
            passkey: {
              id,
              name,
            },
          },
          error: null,
        };
      },
    );

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "edit-MacBook Touch ID" });
    await user.click(
      screen.getByRole("button", { name: "edit-MacBook Touch ID" }),
    );

    const input = screen.getByRole("textbox", { name: "editInputLabel" });

    await user.clear(input);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(mockUpdatePasskey).toHaveBeenCalledWith({
        id: "passkey-1",
        name: "",
      });
    });

    expect(await screen.findByText("defaultName")).toBeInTheDocument();
  });

  it("cancels passkey rename without saving", async () => {
    const user = userEvent.setup();

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "edit-MacBook Touch ID" });
    await user.click(
      screen.getByRole("button", { name: "edit-MacBook Touch ID" }),
    );

    await user.click(screen.getByRole("button", { name: "cancel" }));

    expect(mockUpdatePasskey).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "editInputLabel" }),
    ).toBeNull();
  });

  it("cancels passkey rename when the user presses Escape", async () => {
    const user = userEvent.setup();

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "edit-MacBook Touch ID" });
    await user.click(
      screen.getByRole("button", { name: "edit-MacBook Touch ID" }),
    );

    const input = screen.getByRole("textbox", { name: "editInputLabel" });

    await user.type(input, "{Escape}");

    expect(mockUpdatePasskey).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "editInputLabel" }),
    ).toBeNull();
  });

  it("shows an error when passkey rename fails", async () => {
    const user = userEvent.setup();
    mockUpdatePasskey.mockResolvedValueOnce({
      data: null,
      error: {
        code: "FAILED",
        message: "rename failed",
      },
    });

    render(<PasskeySettings />);

    await screen.findByRole("button", { name: "edit-MacBook Touch ID" });
    await user.click(
      screen.getByRole("button", { name: "edit-MacBook Touch ID" }),
    );
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("renameError: rename failed");
    });
  });

  it("shows an inline retry state when loading passkeys throws", async () => {
    mockListUserPasskeys.mockRejectedValueOnce(new Error("network down"));

    render(<PasskeySettings />);

    await waitFor(() => {
      expect(screen.getByText("loadError")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("falls back to the generic add passkey error when no message is returned", async () => {
    const user = userEvent.setup();
    mockAddPasskey.mockResolvedValueOnce({
      data: null,
      error: {
        code: "FAILED",
      },
    });

    render(<PasskeySettings />);

    await user.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("addError");
    });
  });

  it("retries loading passkeys after an inline load error", async () => {
    mockListUserPasskeys.mockResolvedValueOnce({
      data: null,
      error: {
        code: "FAILED",
        message: "list failed",
        status: 500,
        statusText: "INTERNAL_SERVER_ERROR",
      },
    });

    render(<PasskeySettings />);

    await waitFor(() => {
      expect(screen.getByText("loadError")).toBeInTheDocument();
    });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "retry" }));

    expect(await screen.findByText("MacBook Touch ID")).toBeInTheDocument();
    expect(screen.queryByText("loadError")).not.toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("disables the add button while retrying a failed passkey load", async () => {
    const pendingRetry = createDeferred<{
      data: typeof currentPasskeys;
      error: null;
    }>();

    mockListUserPasskeys.mockResolvedValueOnce({
      data: null,
      error: {
        code: "FAILED",
        message: "list failed",
        status: 500,
        statusText: "INTERNAL_SERVER_ERROR",
      },
    });
    mockListUserPasskeys.mockImplementationOnce(() => pendingRetry.promise);

    render(<PasskeySettings />);

    await waitFor(() => {
      expect(screen.getByText("loadError")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "add" })).not.toBeDisabled();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "retry" }));

    expect(screen.getByRole("button", { name: "add" })).toBeDisabled();

    pendingRetry.resolve({
      data: currentPasskeys,
      error: null,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "add" })).not.toBeDisabled();
    });
  });
});
