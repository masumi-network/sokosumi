import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import { removeProjectDesignMd } from "@/lib/actions/project/action";

const { generateMock, refreshMock, resumeMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  refreshMock: vi.fn(),
  resumeMock: vi.fn(),
}));

const MESSAGES: Record<string, string> = {
  brand: "Brand",
  "brandCard.ready": "Ready",
  "brandCard.generating": "Generating…",
  "brandCard.notSet": "Not set",
  "brandCard.generate": "Generate from website",
  "brandCard.missingWebsite":
    "Add a project website before generating brand context.",
  "brandCard.open": "Open",
  "brandCard.edit": "Edit",
  "brandCard.remove": "Remove",
  "brandCard.upload": "Upload",
  "brandCard.moreActions": "Brand actions",
  "brandCard.removed": "Brand context removed",
  "brandCard.removeDialog.title": "Remove brand context?",
  "brandCard.removeDialog.description":
    "This removes the project's DESIGN.md file.",
  "deleteDialog.cancel": "Cancel",
  "errors.brand": "Couldn't update project brand context",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => MESSAGES[key] ?? key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/project/action", () => ({
  removeProjectDesignMd: vi.fn(),
}));

vi.mock("@/components/design-md", () => ({
  DESIGN_MD_TRANSLATION_NAMESPACE: "App.DesignMd",
  DesignMdUploadTrigger: ({
    onSaved,
  }: {
    onSaved?: (value: {
      extractionId: string | null;
      previewUrl: string | null;
      url: string;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSaved?.({
          extractionId: null,
          previewUrl: null,
          url: "https://blob.example/uploaded/DESIGN.md",
        })
      }
    >
      Upload existing
    </button>
  ),
  useDesignMdGeneration: () => ({
    errorMessage: null,
    generate: generateMock,
    isRunning: false,
    reset: vi.fn(),
    resume: resumeMock,
    status: "idle",
  }),
}));

function renderBrandDashboard({
  designMd = {
    extractionId: "extract-1",
    url: "https://blob.example/DESIGN.md",
  },
  websiteUrl = "https://example.com",
}: {
  designMd?: { extractionId: string | null; url: string } | null;
  websiteUrl?: string | null;
} = {}) {
  return render(
    <ProjectBrandProvider
      projectId="project-1"
      initialDesignMd={designMd}
      websiteUrl={websiteUrl}
    >
      <ProjectBrandCard
        projectId="project-1"
        projectName="Launch"
        websiteUrl={websiteUrl}
      />
    </ProjectBrandProvider>,
  );
}

async function openBrandMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Brand actions" }));
}

describe("ProjectBrandCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("keeps status visible and puts brand actions in a dots menu", async () => {
    const user = userEvent.setup();
    renderBrandDashboard();

    const card = screen.getByTestId("project-brand-card");
    expect(card.className).not.toContain("bg-muted/30");
    expect(card.className).not.toMatch(/\bborder\b/);
    expect(screen.getByRole("heading", { name: "Brand" })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();

    await openBrandMenu(user);
    expect(screen.getByRole("menuitem", { name: /Open/ })).toHaveAttribute(
      "href",
      "https://blob.example/DESIGN.md",
    );
    expect(screen.getByRole("menuitem", { name: /Edit/ })).toHaveAttribute(
      "href",
      "/projects/project-1/design-md/edit",
    );

    await user.click(
      screen.getByRole("menuitem", { name: /Generate from website/ }),
    );
    expect(generateMock).toHaveBeenCalledWith({
      force: true,
      url: "https://example.com",
    });
  });

  it("updates from upload and removes through the project action", async () => {
    const user = userEvent.setup();
    const removeMock = vi.mocked(removeProjectDesignMd);
    removeMock.mockResolvedValue({ projectId: "project-1" });
    renderBrandDashboard({ designMd: null });

    expect(screen.getByText("Not set")).toBeInTheDocument();
    await openBrandMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Upload/ }));
    await user.click(screen.getByRole("button", { name: "Upload existing" }));

    await openBrandMenu(user);
    expect(screen.getByRole("menuitem", { name: /Open/ })).toHaveAttribute(
      "href",
      "https://blob.example/uploaded/DESIGN.md",
    );
    await user.click(screen.getByRole("menuitem", { name: /Remove/ }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(removeMock).toHaveBeenCalledWith({ projectId: "project-1" });
    });
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("does not auto-recreate an existing brand after removal", async () => {
    const user = userEvent.setup();
    vi.mocked(removeProjectDesignMd).mockResolvedValue({
      projectId: "project-1",
    });
    renderBrandDashboard();

    await openBrandMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Remove/ }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("Not set")).toBeInTheDocument(),
    );
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("resumes a pending wizard generation on the project page", async () => {
    window.sessionStorage.setItem(
      "sokosumi:project-brand-job:project-1",
      JSON.stringify({
        jobId: "job-1",
        jobToken: "token-1",
        url: "https://example.com",
      }),
    );

    renderBrandDashboard({ designMd: null });

    await waitFor(() =>
      expect(resumeMock).toHaveBeenCalledWith({
        jobId: "job-1",
        jobToken: "token-1",
        url: "https://example.com",
      }),
    );
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("auto-starts once when a website project has no brand job", async () => {
    renderBrandDashboard({ designMd: null });

    await waitFor(() =>
      expect(generateMock).toHaveBeenCalledWith({
        url: "https://example.com",
      }),
    );
    expect(generateMock).toHaveBeenCalledOnce();
  });

  it("disables generation and explains when website is missing", async () => {
    const user = userEvent.setup();
    renderBrandDashboard({ designMd: null, websiteUrl: null });

    await openBrandMenu(user);
    expect(
      screen.getByRole("menuitem", { name: /Generate from website/ }),
    ).toHaveAttribute("data-disabled");
    expect(
      screen.getByText(
        "Add a project website before generating brand context.",
      ),
    ).toBeInTheDocument();
  });
});
