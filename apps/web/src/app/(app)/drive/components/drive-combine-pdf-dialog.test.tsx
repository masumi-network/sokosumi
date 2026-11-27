import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
const api = vi.hoisted(() => ({ combineDrivePdfs: vi.fn() }));
vi.mock("@/lib/utils/file-search.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/file-search.client")>()),
  ...api,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const save = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock("@/lib/files-archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files-archive")>()),
  ...save,
}));

import { DriveCombinePdfError } from "@/lib/utils/file-search.client";
import { DriveCombinePdfDialog } from "./drive-combine-pdf-dialog";

const files = [
  { pathname: "drive/users/u/Pack/a.pdf", name: "a.pdf" },
  { pathname: "drive/users/u/Pack/b.pdf", name: "b.pdf" },
];

describe("DriveCombinePdfDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("downloads the files combined in the order the reader set", async () => {
    const pdf = new Blob(["%PDF"], { type: "application/pdf" });
    api.combineDrivePdfs.mockResolvedValue(pdf);
    const onOpenChange = vi.fn();
    render(
      <DriveCombinePdfDialog
        files={files}
        onOpenChange={onOpenChange}
        onCloseFocus={() => {}}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: 'moveDown {"name":"a.pdf"}' }),
    );
    const name = screen.getByLabelText("nameLabel");
    await userEvent.clear(name);
    await userEvent.type(name, "Pack");
    await userEvent.click(screen.getByRole("button", { name: "download" }));

    expect(api.combineDrivePdfs).toHaveBeenCalledWith({
      pathnames: [files[1].pathname, files[0].pathname],
      filename: "Pack",
    });
    expect(save.saveBlob).toHaveBeenCalledWith(pdf, "Pack.pdf");
    expect(toast.success).toHaveBeenCalledWith(
      'downloaded {"name":"Pack.pdf"}',
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and names the file that could not be read", async () => {
    api.combineDrivePdfs.mockRejectedValue(
      new DriveCombinePdfError(422, "unreadable_pdf", "b.pdf"),
    );
    const onOpenChange = vi.fn();
    render(
      <DriveCombinePdfDialog
        files={files}
        onOpenChange={onOpenChange}
        onCloseFocus={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "download" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'unreadable {"name":"b.pdf"}',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(save.saveBlob).not.toHaveBeenCalled();
  });

  it("keeps a name that already ends in .pdf and makes it safe to save", async () => {
    api.combineDrivePdfs.mockResolvedValue(new Blob(["%PDF"]));
    render(
      <DriveCombinePdfDialog
        files={files}
        onOpenChange={() => {}}
        onCloseFocus={() => {}}
      />,
    );

    const name = screen.getByLabelText("nameLabel");
    await userEvent.clear(name);
    await userEvent.type(name, "Q3/Board.PDF");
    await userEvent.click(screen.getByRole("button", { name: "download" }));

    expect(save.saveBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "Q3-Board.PDF",
    );
  });

  it("hands focus back when the dialog closes", async () => {
    const onCloseFocus = vi.fn();
    const { rerender } = render(
      <DriveCombinePdfDialog
        files={files}
        onOpenChange={() => {}}
        onCloseFocus={onCloseFocus}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(
      <DriveCombinePdfDialog
        files={null}
        onOpenChange={() => {}}
        onCloseFocus={onCloseFocus}
      />,
    );

    await waitFor(() => expect(onCloseFocus).toHaveBeenCalled());
  });

  it("keeps keyboard focus on the moved file when it reaches the end", async () => {
    render(
      <DriveCombinePdfDialog
        files={files}
        onOpenChange={() => {}}
        onCloseFocus={() => {}}
      />,
    );

    screen.getByRole("button", { name: 'moveDown {"name":"a.pdf"}' }).focus();
    await userEvent.keyboard("{Enter}");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: 'moveUp {"name":"a.pdf"}' }),
    );
  });
});
