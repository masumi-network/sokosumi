import { Organization } from "@sokosumi/database";
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
import { uploadUserFileDirect } from "@/lib/utils/user-file-upload.client";
import OrganizationEditButton from "../organization-edit-button";
import { OrganizationMetadataProvider } from "../organization-metadata-context";

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

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  uploadUserFileDirect: vi.fn(),
}));

const mockedUploadLogo = vi.mocked(uploadUserFileDirect);
const mockedOrganizationUpdate = vi.mocked(authClient.organization.update);

function createOrganization(
  overrides: Partial<Organization> & Pick<Organization, "id" | "name">,
): Organization {
  return {
    metadata: null,
    logo: null,
    slug: "acme",
    ...overrides,
  } as Organization;
}

function OrganizationEditButtonHarness({
  organizationSeed,
}: {
  organizationSeed: Organization;
}) {
  const [tick, setTick] = useState(0);

  const organization = {
    ...organizationSeed,
    // New object reference each parent render (simulates RSC refresh payload).
    _rerenderTick: tick,
  } as Organization;

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
        pathname: "users/user_123/logo.png",
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

  it("sends empty string for logo in the update payload when the logo is cleared", async () => {
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
          logo: "",
        }),
      }),
    );
  });
});
