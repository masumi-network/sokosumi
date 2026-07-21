import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listOrchestratorsMock = vi.fn();
const getOrchestratorByIdMock = vi.fn();
const patchOrchestratorByIdMock = vi.fn();
const uploadOrchestratorImageMock = vi.fn();
const deleteOrchestratorImageMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  },
  coreClient: {
    listOrchestrators: (...args: unknown[]) => listOrchestratorsMock(...args),
    getOrchestratorById: (...args: unknown[]) =>
      getOrchestratorByIdMock(...args),
    patchOrchestratorById: (...args: unknown[]) =>
      patchOrchestratorByIdMock(...args),
    uploadOrchestratorImage: (...args: unknown[]) =>
      uploadOrchestratorImageMock(...args),
    deleteOrchestratorImage: (...args: unknown[]) =>
      deleteOrchestratorImageMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { adminOrchestratorService } from "../admin-orchestrator.service";

const orchestrator = {
  id: "orch_1",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
  archivedAt: null,
  slug: "hermes",
  name: "Hermes",
  caption: "Ops caption",
  description: "Ops description",
  image: "https://example.com/image.png",
};

describe("adminOrchestratorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps list orchestrators", async () => {
    listOrchestratorsMock.mockResolvedValue({ data: [orchestrator] });

    const result = await adminOrchestratorService.listOrchestrators();

    expect(result).toEqual([
      {
        id: "orch_1",
        name: "Hermes",
        slug: "hermes",
        caption: "Ops caption",
        description: "Ops description",
        image: "https://example.com/image.png",
      },
    ]);
  });

  it("returns null when orchestrator is missing", async () => {
    getOrchestratorByIdMock.mockRejectedValue(
      new CoreApiRequestError("Not found", { status: 404 }),
    );

    const result = await adminOrchestratorService.getOrchestrator("orch_1");

    expect(result).toBeNull();
  });

  it("patches text before uploading image", async () => {
    patchOrchestratorByIdMock.mockResolvedValue({
      data: { ...orchestrator, name: "Hermes Ops" },
    });
    uploadOrchestratorImageMock.mockResolvedValue({
      data: {
        ...orchestrator,
        name: "Hermes Ops",
        image: "https://example.com/new.png",
      },
    });

    const file = new File(["x"], "new.png", { type: "image/png" });
    const result = await adminOrchestratorService.updateDisplay({
      id: "orch_1",
      patchBody: { name: "Hermes Ops" },
      imageIntent: "upload",
      imageFile: file,
    });

    expect(patchOrchestratorByIdMock).toHaveBeenCalledBefore(
      uploadOrchestratorImageMock,
    );
    expect(result.orchestrator.name).toBe("Hermes Ops");
    expect(result.orchestrator.image).toBe("https://example.com/new.png");
    expect(result.imageError).toBeUndefined();
  });

  it("keeps saved text when image upload fails", async () => {
    patchOrchestratorByIdMock.mockResolvedValue({
      data: { ...orchestrator, name: "Hermes Ops" },
    });
    uploadOrchestratorImageMock.mockRejectedValue(new Error("blob down"));

    const file = new File(["x"], "new.png", { type: "image/png" });
    const result = await adminOrchestratorService.updateDisplay({
      id: "orch_1",
      patchBody: { name: "Hermes Ops" },
      imageIntent: "upload",
      imageFile: file,
    });

    expect(result.orchestrator.name).toBe("Hermes Ops");
    expect(result.imageError).toBe("blob down");
  });

  it("uploads image without a text patch", async () => {
    uploadOrchestratorImageMock.mockResolvedValue({
      data: {
        ...orchestrator,
        image: "https://example.com/new.png",
      },
    });

    const file = new File(["x"], "new.png", { type: "image/png" });
    const result = await adminOrchestratorService.updateDisplay({
      id: "orch_1",
      imageIntent: "upload",
      imageFile: file,
    });

    expect(patchOrchestratorByIdMock).not.toHaveBeenCalled();
    expect(uploadOrchestratorImageMock).toHaveBeenCalledWith("orch_1", file);
    expect(result.orchestrator.image).toBe("https://example.com/new.png");
    expect(result.imageError).toBeUndefined();
  });

  it("removes image without a text patch", async () => {
    deleteOrchestratorImageMock.mockResolvedValue({
      data: {
        ...orchestrator,
        image: null,
      },
    });

    const result = await adminOrchestratorService.updateDisplay({
      id: "orch_1",
      imageIntent: "remove",
    });

    expect(patchOrchestratorByIdMock).not.toHaveBeenCalled();
    expect(deleteOrchestratorImageMock).toHaveBeenCalledWith("orch_1");
    expect(result.orchestrator.image).toBeNull();
    expect(result.imageError).toBeUndefined();
  });
});
