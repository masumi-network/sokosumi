import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authClient } from "@/lib/auth/auth.client";
import type { OrganizationRecord } from "@/lib/clients/generated/core";
import { uploadOrganizationLogoDirect } from "@/lib/utils/organization-logo-upload.client";
import OrganizationEditButton from "./organization-edit-button";
import { OrganizationMetadataProvider } from "./organization-metadata-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/organizations/acme",
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    isPending: false,
    handleSelectWorkspace: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (...segments: string[]) =>
      segments.join("."),
}));

vi.mock("@/lib/actions/organization", () => ({
  updatePreferredOrganization: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/actions", () => ({
  generateOrganizationSlug: vi.fn(),
}));

vi.mock("@/lib/utils/organization-logo-upload.client", () => ({
  uploadOrganizationLogoDirect: vi.fn(),
  cleanupOrganizationLogoBestEffort: vi.fn(),
  getOrganizationLogoUploadErrorMessage: () => "upload failed",
}));

const mockedUploadLogo = vi.mocked(uploadOrganizationLogoDirect);
const mockedOrganizationUpdate = vi.mocked(authClient.organization.update);

function createOrganization(
  overrides: Partial<OrganizationRecord> &
    Pick<OrganizationRecord, "id" | "name">,
): OrganizationRecord {
  return {
    slug: "acme",
    logo: null,
    metadata: null,
    stripeCustomerId: null,
    createdAt: new Date("2026-04-15T10:00:00.000Z"),
    ...overrides,
  };
}

function OrganizationEditButtonHarness({
  organizationSeed,
}: {
  organizationSeed: OrganizationRecord;
}) {
  const [tick, setTick] = useState(0);

  const organization = {
    ...organizationSeed,
    // New object reference each parent render (simulates RSC refresh payload).
    _rerenderTick: tick,
  } as OrganizationRecord;

  return (
    <OrganizationMetadataProvider organization={organization}>
      <div>
        <button
          type="button"
          aria-label="Simulate parent rerender"
          onClick={() => setTick((value) => value + 1)}
        >
          rerender-parent
        </button>
        <OrganizationEditButton organization={organization} />
      </div>
    </OrganizationMetadataProvider>
  );
}

describe("OrganizationEditButton", () => {
  beforeEach(() => {
    mockedUploadLogo.mockReset();
    mockedOrganizationUpdate.mockReset();
  });

  it("keeps the draft logo preview after upload when the parent rerenders", async () => {
    const uploadedUrl =
      "https://otherstore.public.blob.vercel-storage.com/org/logo.png";

    mockedUploadLogo.mockResolvedValue({
      publicUrl: uploadedUrl,
      metadata: {
        pathname: "organizations/org_1/logos/logo.png",
        downloadUrl: "https://blob.example/download/logo.png",
        size: 1,
        uploadedAt: new Date("2026-03-24T12:00:00.000Z"),
        etag: '"etag-123"',
      },
    });

    const user = userEvent.setup();
    const organization = createOrganization({
      id: "org_1",
      name: "Acme",
    });

    render(<OrganizationEditButtonHarness organizationSeed={organization} />);

    await user.click(screen.getByRole("button", { name: "edit" }));

    const dialog = await screen.findByRole("dialog");
    const fileInput = dialog.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;

    const file = new File(["x"], "logo.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: dataTransfer.files } });
    });

    await waitFor(() => {
      expect(mockedUploadLogo).toHaveBeenCalled();
    });

    expect(mockedUploadLogo).toHaveBeenCalledWith(
      "org_1",
      expect.any(File),
      expect.objectContaining({
        maxSizeBytes: expect.any(Number),
      }),
    );

    expect(
      await within(dialog).findByRole("button", { name: "Fields.Logo.remove" }),
    ).toBeInTheDocument();

    const rerunParent = document.querySelector(
      'button[aria-label="Simulate parent rerender"]',
    );
    expect(rerunParent).not.toBeNull();
    fireEvent.click(rerunParent as HTMLButtonElement);

    const dialogAfter = screen.getByRole("dialog");
    expect(
      within(dialogAfter).getByRole("button", { name: "Fields.Logo.remove" }),
    ).toBeInTheDocument();
  });

  it("sends null for logo in the update payload when the logo is cleared", async () => {
    mockedOrganizationUpdate.mockResolvedValue({
      data: {},
      error: null,
    } as Awaited<ReturnType<typeof authClient.organization.update>>);

    const user = userEvent.setup();
    const organization = createOrganization({
      id: "org_1",
      name: "Acme",
      logo: "https://example.com/existing.png",
    });

    render(<OrganizationEditButtonHarness organizationSeed={organization} />);

    await user.click(screen.getByRole("button", { name: "edit" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Fields.Logo.remove" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Submit.edit" }),
    );

    await waitFor(() => {
      expect(mockedOrganizationUpdate).toHaveBeenCalled();
    });

    expect(mockedOrganizationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        data: expect.objectContaining({
          name: "Acme",
          logo: null,
        }),
      }),
    );
  });

  it("keeps the uploaded logo URL on save after replace (not empty string)", async () => {
    const uploadedUrl =
      "https://otherstore.public.blob.vercel-storage.com/organizations/org_1/logos/new.png";

    mockedUploadLogo.mockResolvedValue({
      publicUrl: uploadedUrl,
      metadata: {
        pathname: "organizations/org_1/logos/new.png",
        downloadUrl: "https://blob.example/download/new.png",
        size: 1,
        uploadedAt: new Date("2026-03-24T12:00:00.000Z"),
        etag: '"etag-456"',
      },
    });
    mockedOrganizationUpdate.mockResolvedValue({
      data: {},
      error: null,
    } as Awaited<ReturnType<typeof authClient.organization.update>>);

    const user = userEvent.setup();
    const organization = createOrganization({
      id: "org_1",
      name: "Acme",
      logo: "https://example.com/existing.png",
    });

    render(<OrganizationEditButtonHarness organizationSeed={organization} />);

    await user.click(screen.getByRole("button", { name: "edit" }));

    const dialog = await screen.findByRole("dialog");
    const fileInput = dialog.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;

    const file = new File(["x"], "logo.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: dataTransfer.files } });
    });

    await waitFor(() => {
      expect(mockedUploadLogo).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "Submit.edit" }),
      ).not.toBeDisabled();
    });

    await user.click(
      within(dialog).getByRole("button", { name: "Submit.edit" }),
    );

    await waitFor(() => {
      expect(mockedOrganizationUpdate).toHaveBeenCalled();
    });

    expect(mockedOrganizationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        data: expect.objectContaining({
          logo: uploadedUrl,
        }),
      }),
    );
    expect(mockedOrganizationUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ logo: "" }),
      }),
    );
    expect(mockedOrganizationUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ logo: null }),
      }),
    );
  });
});
