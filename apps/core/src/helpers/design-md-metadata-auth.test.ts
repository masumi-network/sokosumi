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
} from "./design-md-metadata-auth";

describe("sanitizeOrganizationMetadataForCreate", () => {
  it("strips designMd fields from create payloads", () => {
    expect(
      sanitizeOrganizationMetadataForCreate({
        url: "https://acme.example",
        designMdUrl: "https://evil.example/ssrf",
      }),
    ).toEqual({ url: "https://acme.example" });
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
      url: "https://acme.example",
      designMdUrl: "https://abc.public.blob.vercel-storage.com/design-md/ok.md",
    });
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
    ).toBe(JSON.stringify({ url: "https://acme.example" }));
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
        url: "https://acme.example",
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
      metadata: JSON.stringify({ url: "https://acme.example" }),
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
        url: "https://acme.example",
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
      metadata: { url: "https://acme.example" },
    });
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
        url: "https://acme.example",
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
