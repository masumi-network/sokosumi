import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEffectiveMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/design-md.service", () => ({
  designMdService: { resolveEffectiveDesignMd: resolveEffectiveMock },
}));

const { organizationBrandName } = await import(
  "@/app/projects/organization-brand-name"
);

const EMPTY_PROJECT = { cmo: false, designMd: null };

describe("organizationBrandName", () => {
  beforeEach(() => {
    resolveEffectiveMock.mockReset();
  });

  it("names the organization whose DESIGN.md an empty Project can copy", async () => {
    resolveEffectiveMock.mockResolvedValue({
      label: "DESIGN.md",
      url: "https://blob.example/org/DESIGN.md",
      owner: { type: "organization", name: "Acme", logo: null },
    });

    await expect(organizationBrandName(EMPTY_PROJECT)).resolves.toBe("Acme");
  });

  it("offers nothing in a personal workspace or when the read fails", async () => {
    resolveEffectiveMock.mockResolvedValueOnce({
      label: "DESIGN.md",
      url: "https://blob.example/me/DESIGN.md",
      owner: { type: "user" },
    });
    await expect(organizationBrandName(EMPTY_PROJECT)).resolves.toBeNull();

    resolveEffectiveMock.mockRejectedValueOnce(new Error("Core down"));
    await expect(organizationBrandName(EMPTY_PROJECT)).resolves.toBeNull();
  });

  it("lets a sign-in redirect through instead of hiding it", async () => {
    let signInRedirect: unknown;
    try {
      redirect("/signin");
    } catch (error) {
      signInRedirect = error;
    }
    resolveEffectiveMock.mockRejectedValueOnce(signInRedirect);

    await expect(organizationBrandName(EMPTY_PROJECT)).rejects.toBe(
      signInRedirect,
    );
  });

  it("skips the lookup for a Project with a brand or a CMO Project", async () => {
    await expect(
      organizationBrandName({ cmo: false, designMd: { url: "x" } }),
    ).resolves.toBeNull();
    await expect(
      organizationBrandName({ cmo: true, designMd: null }),
    ).resolves.toBeNull();
    expect(resolveEffectiveMock).not.toHaveBeenCalled();
  });
});
