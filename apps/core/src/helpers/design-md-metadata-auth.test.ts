import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserByIdMock,
  organizationFindUniqueMock,
  resolveDatabaseHookUserIdMock,
} = vi.hoisted(() => ({
  getUserByIdMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  resolveDatabaseHookUserIdMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
    },
  },
}));

vi.mock("@/services/stripe-user-email.service", () => ({
  resolveDatabaseHookUserId: (...args: unknown[]) =>
    resolveDatabaseHookUserIdMock(...args),
}));

import {
  applyDesignMdMetadataGuardToOrganizationCreate,
  applyDesignMdMetadataGuardToOrganizationUpdate,
  applyDesignMdMetadataGuardToUserCreate,
  applyDesignMdMetadataGuardToUserUpdate,
  sanitizeOrganizationMetadataForCreate,
  sanitizeOrganizationMetadataForUpdate,
  sanitizeUserMetadataForCreate,
  sanitizeUserMetadataForUpdate,
  withValidatedWebsiteUrl,
} from "./design-md-metadata-auth";

describe("withValidatedWebsiteUrl", () => {
  it("normalizes bare domains to https URLs", () => {
    expect(withValidatedWebsiteUrl({ url: "acme.com" })).toEqual({
      url: "https://acme.com/",
    });
  });

  it("allows missing or empty url", () => {
    expect(
      withValidatedWebsiteUrl({ designMdUrl: "https://x.com/a.md" }),
    ).toEqual({ designMdUrl: "https://x.com/a.md" });
    expect(withValidatedWebsiteUrl({ url: "  " })).toBeNull();
  });

  it.each([
    "acme",
    "localhost",
    "https://localhost",
    "https://127.0.0.1",
    "not a url",
  ])("rejects invalid website url %s", (url) => {
    expect(() => withValidatedWebsiteUrl({ url })).toThrow(APIError);
    try {
      withValidatedWebsiteUrl({ url });
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      expect((error as APIError).status).toBe("BAD_REQUEST");
      expect((error as APIError).body?.code).toBe("INVALID_WEBSITE_URL");
    }
  });
});

describe("sanitizeOrganizationMetadataForCreate", () => {
  it("strips designMd fields from create payloads", () => {
    expect(
      sanitizeOrganizationMetadataForCreate({
        url: "https://acme.example",
        designMdUrl: "https://evil.example/ssrf",
      }),
    ).toEqual({ url: "https://acme.example/" });
  });

  it("rejects invalid website urls on create", () => {
    expect(() =>
      sanitizeOrganizationMetadataForCreate({ url: "acme" }),
    ).toThrow(APIError);
  });
});

describe("sanitizeOrganizationMetadataForUpdate", () => {
  it("preserves existing designMd fields over client values", () => {
    expect(
      sanitizeOrganizationMetadataForUpdate(
        {
          url: "https://acme.example",
          designMdUrl: "https://evil.example/ssrf",
        },
        JSON.stringify({
          designMdUrl:
            "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
        }),
      ),
    ).toEqual({
      url: "https://acme.example/",
      designMdUrl: "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
    });
  });

  it("rejects invalid website urls on update", () => {
    expect(() =>
      sanitizeOrganizationMetadataForUpdate({ url: "https://localhost" }, null),
    ).toThrow(APIError);
  });
});

describe("sanitizeUserMetadataForCreate", () => {
  it("returns serialized metadata without designMd fields", () => {
    expect(
      sanitizeUserMetadataForCreate(
        JSON.stringify({
          url: "https://acme.example",
          designMdUrl: "https://evil.example/ssrf",
        }),
      ),
    ).toBe(JSON.stringify({ url: "https://acme.example/" }));
  });
});

describe("sanitizeUserMetadataForUpdate", () => {
  it("returns serialized metadata with preserved designMd fields", () => {
    expect(
      sanitizeUserMetadataForUpdate(
        JSON.stringify({
          url: "https://acme.example",
          designMdUrl: "https://evil.example/ssrf",
        }),
        JSON.stringify({
          designMdUrl:
            "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
          designMdExtractionId: "7",
        }),
      ),
    ).toBe(
      JSON.stringify({
        url: "https://acme.example/",
        designMdUrl:
          "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
        designMdExtractionId: "7",
      }),
    );
  });
});

describe("applyDesignMdMetadataGuardToUserCreate", () => {
  it("leaves payloads without metadata unchanged", () => {
    const user = { email: "a@example.com", name: "A" };
    expect(applyDesignMdMetadataGuardToUserCreate(user)).toBe(user);
  });

  it("strips designMd fields from metadata", () => {
    expect(
      applyDesignMdMetadataGuardToUserCreate({
        email: "a@example.com",
        metadata: JSON.stringify({
          url: "https://acme.example",
          designMdUrl: "https://evil.example/ssrf",
        }),
      }),
    ).toEqual({
      email: "a@example.com",
      metadata: JSON.stringify({ url: "https://acme.example/" }),
    });
  });
});

describe("applyDesignMdMetadataGuardToUserUpdate", () => {
  beforeEach(() => {
    getUserByIdMock.mockReset();
    resolveDatabaseHookUserIdMock.mockReset();
  });

  it("leaves payloads without metadata unchanged", async () => {
    const updateData = { email: "new@example.com" };
    await expect(
      applyDesignMdMetadataGuardToUserUpdate(updateData, {}),
    ).resolves.toBe(updateData);
    expect(resolveDatabaseHookUserIdMock).not.toHaveBeenCalled();
  });

  it("preserves server designMd fields from the existing user row", async () => {
    resolveDatabaseHookUserIdMock.mockReturnValue("user_1");
    getUserByIdMock.mockResolvedValue({
      metadata: JSON.stringify({
        designMdUrl:
          "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
      }),
    });

    await expect(
      applyDesignMdMetadataGuardToUserUpdate(
        {
          metadata: JSON.stringify({
            url: "https://acme.example",
            designMdUrl: "https://evil.example/ssrf",
          }),
        },
        { session: { user: { id: "user_1" } } },
      ),
    ).resolves.toEqual({
      metadata: JSON.stringify({
        url: "https://acme.example/",
        designMdUrl:
          "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
      }),
    });
  });
});

describe("applyDesignMdMetadataGuardToOrganizationCreate", () => {
  it("strips designMd fields from organization metadata", () => {
    expect(
      applyDesignMdMetadataGuardToOrganizationCreate({
        name: "Acme",
        metadata: {
          url: "https://acme.example",
          designMdUrl: "https://evil.example/ssrf",
        },
      }),
    ).toEqual({
      name: "Acme",
      metadata: { url: "https://acme.example/" },
    });
  });

  it("rejects organization create with invalid website url", () => {
    expect(() =>
      applyDesignMdMetadataGuardToOrganizationCreate({
        name: "Acme",
        metadata: { url: "acme" },
      }),
    ).toThrow(APIError);
  });
});

describe("applyDesignMdMetadataGuardToOrganizationUpdate", () => {
  beforeEach(() => {
    organizationFindUniqueMock.mockReset();
  });

  it("preserves server designMd fields from the existing organization row", async () => {
    organizationFindUniqueMock.mockResolvedValue({
      metadata: JSON.stringify({
        designMdUrl:
          "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
      }),
    });

    await expect(
      applyDesignMdMetadataGuardToOrganizationUpdate(
        {
          name: "Acme",
          metadata: {
            url: "https://acme.example",
            designMdUrl: "https://evil.example/ssrf",
          },
        },
        "org_1",
      ),
    ).resolves.toEqual({
      name: "Acme",
      metadata: {
        url: "https://acme.example/",
        designMdUrl:
          "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
      },
    });
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "org_1" },
      select: { metadata: true },
    });
  });
});
