import { describe, expect, it, vi } from "vitest";

const { deleteMock, patchLabelMock, searchMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  patchLabelMock: vi.fn(),
  searchMock: vi.fn(),
}));
vi.mock("@sokosumi/core-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/core-client")>()),
  deleteDriveFilesDelete: deleteMock,
  patchDriveLabelsById: patchLabelMock,
  getDriveSearch: searchMock,
}));
vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

import {
  countActiveFileFilters,
  deleteDriveUploads,
  EMPTY_FILE_FILTERS,
  fetchFolderReadme,
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

describe("fetchFolderReadme", () => {
  it("asks for the folder's README by name, sorted by name, so no model reranks it", async () => {
    searchMock.mockResolvedValue({
      data: {
        data: {
          items: [
            { id: "notes", displayName: "readme-notes.md" },
            { id: "readme", displayName: "ReadMe.MD" },
          ],
        },
      },
    });

    const file = await fetchFolderReadme({
      store: { scope: "org", organizationId: "org-1" },
      folder: "Client work",
    });

    expect(file?.id).toBe("readme");
    expect(searchMock.mock.lastCall?.[0].query).toEqual({
      scope: "org",
      organizationId: "org-1",
      q: "README.md",
      folder: "Client work",
      directOnly: "true",
      sortBy: "name",
      sortOrder: "asc",
      limit: 5,
    });
  });

  it("answers null when the folder has no README", async () => {
    searchMock.mockResolvedValue({
      data: { data: { items: [{ id: "a", displayName: "plan.md" }] } },
    });
    await expect(
      fetchFolderReadme({ store: { scope: "me" }, folder: "" }),
    ).resolves.toBeNull();
    expect(searchMock.mock.lastCall?.[0].query.folder).toBeUndefined();
  });
});
