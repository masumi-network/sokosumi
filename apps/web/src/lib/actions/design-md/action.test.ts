import { expectConsole } from "@sokosumi/utils/test-console";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchMarkdownMock,
  persistMock,
  resolveEffectiveMock,
  revalidatePathMock,
  CoreApiRequestError,
} = vi.hoisted(() => ({
  fetchMarkdownMock: vi.fn(),
  persistMock: vi.fn(),
  resolveEffectiveMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  CoreApiRequestError: class extends Error {
    constructor(
      message: string,
      readonly options: { status: number },
    ) {
      super(message);
    }
    get status() {
      return this.options.status;
    }
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams, TResult>(handler: (params: TParams) => Promise<TResult>) =>
    (params: TParams) =>
      handler(params),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {},
  CoreApiRequestError,
}));

vi.mock("@/components/design-md/design-md-edit-page-shared", () => ({
  fetchDesignMdMarkdown: fetchMarkdownMock,
}));

vi.mock("@/lib/services/design-md.service", () => ({
  DesignMdServiceError: class extends Error {},
  designMdService: {
    persistUploadedDesignMd: persistMock,
    resolveEffectiveDesignMd: resolveEffectiveMock,
  },
}));

const { copyOrganizationDesignMdToProject } = await import(
  "@/lib/actions/design-md/action"
);

const ORGANIZATION_DESIGN_MD = {
  label: "DESIGN.md",
  url: "https://blob.example/org/DESIGN.md",
  owner: { type: "organization", name: "Acme", logo: null },
};

function copy() {
  return copyOrganizationDesignMdToProject({
    projectId: "project-1",
  } as Parameters<typeof copyOrganizationDesignMdToProject>[0]);
}

describe("copyOrganizationDesignMdToProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the organization's DESIGN.md as the project's own copy", async () => {
    resolveEffectiveMock.mockResolvedValue(ORGANIZATION_DESIGN_MD);
    fetchMarkdownMock.mockResolvedValue({ markdown: "# Acme brand" });
    persistMock.mockResolvedValue({
      extractionId: null,
      previewUrl: null,
      url: "https://blob.example/project/DESIGN.md",
    });

    const result = await copy();

    expect(fetchMarkdownMock).toHaveBeenCalledWith(ORGANIZATION_DESIGN_MD.url);
    // Only into an empty brand: a brand saved meanwhile is never replaced.
    expect(persistMock).toHaveBeenCalledWith(
      { type: "project", projectId: "project-1" },
      "# Acme brand",
      { onlyIfEmpty: true },
    );
    expect(result).toEqual({
      ok: true,
      value: {
        extractionId: null,
        previewUrl: null,
        url: "https://blob.example/project/DESIGN.md",
      },
    });
  });

  it("refuses when the workspace has no organization DESIGN.md", async () => {
    // A personal workspace resolves to the user's own DESIGN.md.
    resolveEffectiveMock.mockResolvedValue({
      ...ORGANIZATION_DESIGN_MD,
      owner: { type: "user" },
    });

    const result = await copy();

    expect(result.ok).toBe(false);
    expect(fetchMarkdownMock).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("fails without writing when the organization file can't be read", async () => {
    resolveEffectiveMock.mockResolvedValue(ORGANIZATION_DESIGN_MD);
    fetchMarkdownMock.mockResolvedValue({ error: true });

    expectConsole("error", "Failed to copy the organization DESIGN.md");
    const result = await copy();

    expect(result.ok).toBe(false);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("keeps a brand saved meanwhile and refreshes the project to show it", async () => {
    resolveEffectiveMock.mockResolvedValue(ORGANIZATION_DESIGN_MD);
    fetchMarkdownMock.mockResolvedValue({ markdown: "# Acme brand" });
    persistMock.mockRejectedValue(
      new CoreApiRequestError("Project already has a DESIGN.md", {
        status: 409,
      }),
    );

    const result = await copy();

    expect(result).toEqual({
      ok: false,
      error: { code: "BAD_INPUT", message: "Project already has a DESIGN.md" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/projects/project-1");
  });
});
