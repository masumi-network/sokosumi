import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueMock,
  projectUpdateMock,
  fileFindFirstMock,
  driveDelMock,
  tombstoneMock,
  saveFileMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  projectUpdateMock: vi.fn(),
  fileFindFirstMock: vi.fn(),
  driveDelMock: vi.fn(),
  tombstoneMock: vi.fn(),
  saveFileMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findUnique: findUniqueMock, update: projectUpdateMock },
    fileResource: { findFirst: fileFindFirstMock },
  },
}));
vi.mock("@/lib/drive-blob", () => ({ driveDel: driveDelMock }));
vi.mock("@/services/file-catalog.service", () => ({
  tombstoneDriveUploadResource: tombstoneMock,
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  requireCuso: vi.fn(async () => ({
    projectId: "project-1",
    workspaceId: "workspace-1",
  })),
}));
vi.mock("@/services/cuso-project-files.service", () => ({
  cusoDrive: vi.fn(async () => ({ workspaceId: "workspace-1" })),
  saveCusoProjectFile: saveFileMock,
}));

import sharp from "sharp";

import {
  clearCmoPresenter,
  setCmoPresenter,
  talkingVideoPresenter,
} from "./cmo-presenter.service";

const scope = { projectId: "project-1", userId: "user-1" };
const consentAt = new Date("2026-11-18T08:06:45Z");

const photoPath = "drive/organizations/org-1/Presenter/presenter-1.jpg";

beforeEach(() => {
  findUniqueMock.mockReset();
  projectUpdateMock.mockReset();
  fileFindFirstMock.mockReset();
  driveDelMock.mockReset();
  tombstoneMock.mockReset();
  saveFileMock.mockReset();
});

describe("removing the owner's photo", () => {
  beforeEach(() => {
    findUniqueMock.mockResolvedValue({ presenterFileId: "file-1" });
    fileFindFirstMock.mockResolvedValue({
      sourceId: photoPath,
      sourceScope: "ORGANIZATION",
    });
  });

  it("deletes the photo from Files, then forgets it", async () => {
    await clearCmoPresenter(scope);

    expect(driveDelMock).toHaveBeenCalledWith([photoPath]);
    expect(tombstoneMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      scope: "organization",
      pathname: photoPath,
    });
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { presenterFileId: null, presenterConsentAt: null },
      select: { id: true },
    });
  });

  it("keeps the photo set when deleting it fails, so removing again finds it", async () => {
    driveDelMock.mockRejectedValue(new Error("store down"));

    await expect(clearCmoPresenter(scope)).rejects.toThrow("store down");
    expect(projectUpdateMock).not.toHaveBeenCalled();
  });

  it("deletes the previous photo when a new one replaces it", async () => {
    saveFileMock.mockResolvedValue("file-2");
    const photo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#888" },
    })
      .jpeg()
      .toBuffer();

    await setCmoPresenter({ ...scope, photo: new Uint8Array(photo) });

    expect(driveDelMock).toHaveBeenCalledWith([photoPath]);
    expect(projectUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ presenterFileId: "file-2" }),
      }),
    );
  });
});

describe("talkingVideoPresenter", () => {
  it("uses the owner's photo only while it has their consent", async () => {
    findUniqueMock.mockResolvedValue({
      presenterFileId: "file-1",
      presenterConsentAt: consentAt,
      workspace: { organizationId: "org-1" },
    });
    expect(
      await talkingVideoPresenter({ ...scope, presenter: "owner" }),
    ).toEqual({
      kind: "file",
      fileId: "file-1",
      consentAt,
      actor: { kind: "soko_bot", userId: "user-1", organizationId: "org-1" },
    });

    findUniqueMock.mockResolvedValue({
      presenterFileId: "file-1",
      presenterConsentAt: null,
      workspace: { organizationId: "org-1" },
    });
    expect(
      await talkingVideoPresenter({ ...scope, presenter: "owner" }),
    ).toBeNull();
  });

  it("takes a known stock presenter, else the first", async () => {
    expect(
      await talkingVideoPresenter({ ...scope, presenter: "jonas" }),
    ).toEqual({ kind: "stock", id: "jonas" });
    expect(
      await talkingVideoPresenter({ ...scope, presenter: "nobody" }),
    ).toEqual({ kind: "stock", id: "maya" });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
