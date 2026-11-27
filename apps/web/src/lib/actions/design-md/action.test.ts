import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { expectConsole } from "@sokosumi/utils/test-console";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { copyMock, revalidatePathMock, CoreApiRequestError } = vi.hoisted(
  () => ({
    copyMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    CoreApiRequestError: class extends Error {
      constructor(
        message: string,
        readonly options: { status: number; kind?: string },
      ) {
        super(message);
      }
      get status() {
        return this.options.status;
      }
      get kind() {
        return this.options.kind;
      }
    },
  }),
);

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

vi.mock("@/lib/services/design-md.service", () => ({
  DesignMdServiceError: class extends Error {},
  designMdService: { copyOrganizationDesignMdToProject: copyMock },
}));

const { copyOrganizationDesignMdToProject } = await import(
  "@/lib/actions/design-md/action"
);

function copy() {
  return copyOrganizationDesignMdToProject({
    projectId: "project-1",
  } as Parameters<typeof copyOrganizationDesignMdToProject>[0]);
}

describe("copyOrganizationDesignMdToProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks Core for the copy and refreshes the Project", async () => {
    const copied = {
      extractionId: null,
      previewUrl: null,
      url: "https://blob.example/project/DESIGN.md",
    };
    copyMock.mockResolvedValue(copied);

    const result = await copy();

    expect(copyMock).toHaveBeenCalledWith("project-1");
    expect(result).toEqual({ ok: true, value: copied });
    expect(revalidatePathMock).toHaveBeenCalledWith("/projects/project-1");
  });

  it("names a brand saved meanwhile, and refreshes the Project to show it", async () => {
    copyMock.mockRejectedValue(
      new CoreApiRequestError("Project already has a DESIGN.md", {
        status: 409,
        kind: CORE_API_ERROR_KINDS.PROJECT_DESIGN_MD_EXISTS,
      }),
    );

    const result = await copy();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe(
      CORE_API_ERROR_KINDS.PROJECT_DESIGN_MD_EXISTS,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/projects/project-1");
  });

  it("keeps other refusals apart from an existing brand", async () => {
    // A CMO Project is also a 409, and a missing organization brand a 404.
    for (const [status, kind] of [
      [409, CORE_API_ERROR_KINDS.CMO_PROJECT_READ_ONLY],
      [404, CORE_API_ERROR_KINDS.ORGANIZATION_DESIGN_MD_MISSING],
      [404, undefined],
    ] as const) {
      copyMock.mockRejectedValueOnce(
        new CoreApiRequestError("Refused", { status, kind }),
      );
      expectConsole("error", "Failed to copy the organization DESIGN.md");

      const result = await copy();

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.kind).not.toBe(
        CORE_API_ERROR_KINDS.PROJECT_DESIGN_MD_EXISTS,
      );
    }
  });

  it("lets a sign-in redirect through instead of turning it into an error", async () => {
    let signInRedirect: unknown;
    try {
      redirect("/signin");
    } catch (error) {
      signInRedirect = error;
    }
    copyMock.mockRejectedValue(signInRedirect);

    await expect(copy()).rejects.toBe(signInRedirect);
  });
});
