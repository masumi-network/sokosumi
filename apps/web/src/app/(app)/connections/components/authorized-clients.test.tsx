import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthAuthorizedClients } from "./authorized-clients";

const mockGetConsents = vi.fn();
const mockPublicClient = vi.fn();
const mockRevoke = vi.fn();

// Stable like next-intl's own `t`: the component refetches when `t` changes.
const t = (key: string, values?: Record<string, unknown>) =>
  values?.name ? `${key}:${values.name}` : key;

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "Feb 10, 2026" }),
  useTranslations: () => t,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/oauth/action", () => ({
  revokeOAuthClientAccess: (...args: unknown[]) => mockRevoke(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    oauth2: {
      getConsents: (...args: unknown[]) => mockGetConsents(...args),
      publicClient: (...args: unknown[]) => mockPublicClient(...args),
    },
  },
}));

describe("OAuthAuthorizedClients", () => {
  beforeEach(() => {
    mockGetConsents.mockReset();
    mockGetConsents.mockResolvedValue({
      data: [
        {
          id: "consent-1",
          clientId: "client-1",
          createdAt: "2026-02-10T00:00:00.000Z",
        },
        {
          id: "consent-2",
          clientId: "client-2",
          createdAt: "2026-03-19T00:00:00.000Z",
        },
      ],
      error: null,
    });
    mockPublicClient.mockReset();
    mockPublicClient.mockImplementation(
      ({ query }: { query: { client_id: string } }) =>
        Promise.resolve({
          data: {
            client_name: query.client_id === "client-1" ? "Claude" : "Cursor",
          },
          error: null,
        }),
    );
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue({ ok: true, value: undefined });
  });

  async function revokeButtons() {
    await screen.findByText("Cursor");
    return screen.getAllByRole("button", { name: "revokeAccess" });
  }

  it("names an app the viewer authorized but does not own", async () => {
    render(<OAuthAuthorizedClients />);

    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(mockPublicClient).toHaveBeenCalledWith({
      query: { client_id: "client-1" },
    });
  });

  it("names the app in the dialog and revokes nothing until confirmed", async () => {
    const user = userEvent.setup();
    render(<OAuthAuthorizedClients />);

    await user.click((await revokeButtons())[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("confirmRevoke:Claude");

    await user.click(within(dialog).getByRole("button", { name: "cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("returns focus to the opener after Escape and after Cancel", async () => {
    const user = userEvent.setup();
    render(<OAuthAuthorizedClients />);
    const opener = (await revokeButtons())[1];

    opener.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("alertdialog");
    within(dialog).getByRole("button", { name: "cancel" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("moves focus to the next app, then the empty message, as apps are revoked", async () => {
    const user = userEvent.setup();
    render(<OAuthAuthorizedClients />);

    (await revokeButtons())[0].focus();
    await user.keyboard("{Enter}");
    let dialog = await screen.findByRole("alertdialog");
    within(dialog).getByRole("button", { name: "revokeAccess" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockRevoke).toHaveBeenCalledWith("consent-1", "client-1"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Claude")).not.toBeInTheDocument(),
    );
    const survivor = screen.getByRole("button", { name: "revokeAccess" });
    await waitFor(() => expect(survivor).toHaveFocus());

    await user.keyboard("{Enter}");
    dialog = await screen.findByRole("alertdialog");
    within(dialog).getByRole("button", { name: "revokeAccess" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByText("noApplications")).toHaveFocus(),
    );
  });
});
