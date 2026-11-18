import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: { project: { findUnique: findUniqueMock } },
}));

import { talkingVideoPresenter } from "./cmo-presenter.service";

const scope = { projectId: "project-1", userId: "user-1" };
const consentAt = new Date("2026-11-18T08:06:45Z");

beforeEach(() => {
  findUniqueMock.mockReset();
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
