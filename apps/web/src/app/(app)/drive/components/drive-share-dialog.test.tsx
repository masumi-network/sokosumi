import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
const api = vi.hoisted(() => ({
  fetchDriveShare: vi.fn(),
  saveDriveShare: vi.fn(),
  revokeDriveShare: vi.fn(),
}));
vi.mock("@/lib/utils/file-search.client", () => ({
  ...api,
  driveShareUrl: (token: string) => `https://app.test/share/files/${token}`,
}));

import { DriveShareDialog } from "./drive-share-dialog";

const store = { scope: "org" as const, organizationId: "org_1" };
const item = {
  target: { kind: "folder" as const, folderPath: "Masumi Fundraising" },
  name: "Masumi Fundraising",
};
const share = {
  id: "s1",
  token: "tok",
  kind: "folder" as const,
  hasPassword: true,
  createdAt: "2026-10-26T00:00:00.000Z",
};

describe("DriveShareDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a link with the password typed", async () => {
    api.fetchDriveShare.mockResolvedValue(null);
    api.saveDriveShare.mockResolvedValue(share);
    render(
      <DriveShareDialog store={store} item={item} onOpenChange={() => {}} />,
    );

    await userEvent.type(
      await screen.findByLabelText("passwordOptional"),
      "secret123",
    );
    await userEvent.click(screen.getByRole("button", { name: "create" }));

    expect(api.saveDriveShare).toHaveBeenCalledWith({
      store,
      target: item.target,
      password: "secret123",
    });
    expect(
      await screen.findByDisplayValue("https://app.test/share/files/tok"),
    ).toBeInTheDocument();
  });

  it("does not create a link with a password under four characters", async () => {
    api.fetchDriveShare.mockResolvedValue(null);
    render(
      <DriveShareDialog store={store} item={item} onOpenChange={() => {}} />,
    );
    await userEvent.type(
      await screen.findByLabelText("passwordOptional"),
      "abc",
    );
    expect(screen.getByRole("button", { name: "create" })).toBeDisabled();
  });

  it("removes the password and stops sharing", async () => {
    api.fetchDriveShare.mockResolvedValue(share);
    api.saveDriveShare.mockResolvedValue({ ...share, hasPassword: false });
    render(
      <DriveShareDialog store={store} item={item} onOpenChange={() => {}} />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "removePassword" }),
    );
    expect(api.saveDriveShare).toHaveBeenCalledWith({
      store,
      target: item.target,
      password: null,
    });

    await userEvent.click(screen.getByRole("button", { name: "revoke" }));
    await waitFor(() =>
      expect(api.revokeDriveShare).toHaveBeenCalledWith({
        store,
        shareId: "s1",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "create" }),
    ).toBeInTheDocument();
  });
});
