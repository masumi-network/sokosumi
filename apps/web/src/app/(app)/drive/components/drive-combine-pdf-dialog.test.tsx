import { render, screen } from "@testing-library/react";
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
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/queries/drive", () => ({ invalidateDrive: vi.fn() }));

import { DriveCombinePdfError } from "@/lib/utils/file-search.client";
import { DriveCombinePdfDialog } from "./drive-combine-pdf-dialog";

const store = { scope: "me" as const };
const files = [
  { pathname: "drive/users/u/Pack/a.pdf", name: "a.pdf" },
  { pathname: "drive/users/u/Pack/b.pdf", name: "b.pdf" },
];

describe("DriveCombinePdfDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("combines the files in the order the reader set", async () => {
    api.combineDrivePdfs.mockResolvedValue({
      resourceId: "r1",
      name: "Pack.pdf",
      pathname: "drive/users/u/Pack/Pack.pdf",
      pageCount: 3,
    });
    const onOpenChange = vi.fn();
    render(
      <DriveCombinePdfDialog
        files={files}
        store={store}
        onOpenChange={onOpenChange}
        onOpenFile={() => {}}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: 'moveDown {"name":"a.pdf"}' }),
    );
    const name = screen.getByLabelText("nameLabel");
    await userEvent.clear(name);
    await userEvent.type(name, "Pack");
    await userEvent.click(screen.getByRole("button", { name: "combine" }));

    expect(api.combineDrivePdfs).toHaveBeenCalledWith({
      pathnames: [files[1].pathname, files[0].pathname],
      filename: "Pack",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and names the file that could not be read", async () => {
    api.combineDrivePdfs.mockRejectedValue(
      new DriveCombinePdfError(422, '"b.pdf" could not be read as a PDF'),
    );
    const onOpenChange = vi.fn();
    render(
      <DriveCombinePdfDialog
        files={files}
        store={store}
        onOpenChange={onOpenChange}
        onOpenFile={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "combine" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'unreadable {"name":"b.pdf"}',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
