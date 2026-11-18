import { describe, expect, it, vi } from "vitest";

const { deleteMock, patchLabelMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  patchLabelMock: vi.fn(),
}));
vi.mock("@sokosumi/core-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/core-client")>()),
  deleteDriveFilesDelete: deleteMock,
  patchDriveLabelsById: patchLabelMock,
}));
vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

import {
  countActiveFileFilters,
  deleteDriveUploads,
  EMPTY_FILE_FILTERS,
  setWorkspaceTagColor,
} from "@/lib/utils/file-search.client";

it.each([
  ["#127DA2", { customColor: "#127DA2" }],
  ["purple", { color: "purple" }],
  [null, { color: null }],
] as const)("persists a workspace tag color of %s", async (color, field) => {
  patchLabelMock.mockResolvedValue({ data: { data: { id: "tag", ...field } } });
  await setWorkspaceTagColor({ activeOrganizationId: null, id: "tag", color });
  expect(patchLabelMock.mock.lastCall?.[0].body).toEqual({
    scope: "me",
    ...field,
  });
});

describe("deleteDriveUploads", () => {
  it("deletes each file and reports only the ones that failed", async () => {
    deleteMock.mockImplementation(
      async ({ body }: { body: { pathname: string } }) => {
        if (body.pathname.endsWith("locked.md")) throw new Error("403");
      },
    );
    await expect(
      deleteDriveUploads(["drive/u/a.md", "drive/u/locked.md", "drive/u/b.md"]),
    ).resolves.toEqual(["drive/u/locked.md"]);
    expect(deleteMock).toHaveBeenCalledTimes(3);
  });
});

describe("countActiveFileFilters", () => {
  it("counts nothing when no dimension is set", () => {
    expect(countActiveFileFilters(EMPTY_FILE_FILTERS)).toBe(0);
  });

  it("does not count the tag match mode as a filter", () => {
    expect(
      countActiveFileFilters({ ...EMPTY_FILE_FILTERS, tagMatch: "all" }),
    ).toBe(0);
  });

  it("counts every selected value across dimensions", () => {
    expect(
      countActiveFileFilters({
        ...EMPTY_FILE_FILTERS,
        categoryLabelIds: ["c1"],
        tagLabelIds: ["t1", "t2"],
        sourceKinds: ["DRIVE_UPLOAD"],
      }),
    ).toBe(4);
  });
});
