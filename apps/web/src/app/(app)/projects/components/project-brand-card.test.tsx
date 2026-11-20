import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import {
  removeProjectDesignMd,
  updateProject,
} from "@/lib/actions/project/action";

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
  "brandCard.removeDialog.cancel": "Cancel",
  "brandCard.websiteInvalid": "Enter a website like example.com.",
  "brandCard.websiteLabel": "Project website",
  "errors.brand": "Couldn't update project brand context",
  "errors.update": "Failed to update project",
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
  updateProject: vi.fn(),
}));

vi.mock("@/components/design-md/design-md-upload-trigger", () => ({
  DesignMdUploadTrigger: ({
    onSaved,
    onUploadingChange,
  }: {
    onSaved?: (value: {
      extractionId: string | null;
      previewUrl: string | null;
      url: string;
    }) => void;
    onUploadingChange?: (isUploading: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onUploadingChange?.(true)}>
        Start upload
      </button>
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
    </>
  ),
}));
vi.mock("@/components/design-md/use-design-md-generation", () => ({
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
  autoStart,
  designMd = {
    extractionId: "extract-1",
    url: "https://blob.example/DESIGN.md",
  },
  websiteUrl = "https://example.com",
}: {
  autoStart?: boolean;
  designMd?: { extractionId: string | null; url: string } | null;
  websiteUrl?: string | null;
} = {}) {
  const tree = (url: string | null | undefined) => (
    <ProjectBrandProvider
      autoStart={autoStart}
      projectId="project-1"
      initialDesignMd={designMd}
      websiteUrl={url}
    >
      <ProjectBrandCard projectId="project-1" websiteUrl={url} />
    </ProjectBrandProvider>
  );
  const view = render(tree(websiteUrl));
  return {
    ...view,
    /** The revalidated page passing a newly saved website back in. */
    rerenderWithWebsite: (url: string) => view.rerender(tree(url)),
  };
}

async function submitWebsite(
  user: ReturnType<typeof userEvent.setup>,
  value: string,
) {
  await user.type(screen.getByRole("textbox"), value);
  await user.click(
    screen.getByRole("button", { name: "Generate from website" }),
  );
}

function mockSavedWebsite() {
  vi.mocked(updateProject).mockResolvedValue({
    ok: true,
    value: { projectId: "project-1" },
  } as Awaited<ReturnType<typeof updateProject>>);
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
    expect(card.className).not.toContain("bg-card-background");
    expect(card.className).not.toMatch(/\bborder\b/);
    const brandHeading = screen.getByRole("heading", { name: "Brand" });
    expect(brandHeading).toBeInTheDocument();
    expect(brandHeading.parentElement?.textContent).not.toContain("Ready");
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
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.click(screen.getByRole("button", { name: "Upload existing" }));

    await openBrandMenu(user);
    expect(screen.getByRole("menuitem", { name: /Open/ })).toHaveAttribute(
      "href",
      "https://blob.example/uploaded/DESIGN.md",
    );
    await user.click(screen.getByRole("menuitem", { name: /Remove/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
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

  it("leaves new design extraction to the caller when automatic start is disabled", () => {
    renderBrandDashboard({ designMd: null, autoStart: false });

    expect(resumeMock).not.toHaveBeenCalled();
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

    renderBrandDashboard({ designMd: null, autoStart: false });

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

  it("offers the ways to add a DESIGN.md as buttons, not a menu", async () => {
    const user = userEvent.setup();
    renderBrandDashboard({ designMd: null });
    await waitFor(() => expect(generateMock).toHaveBeenCalledOnce());

    expect(screen.queryByRole("button", { name: "Brand actions" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Generate from website" }),
    );
    expect(generateMock).toHaveBeenLastCalledWith({
      force: true,
      url: "https://example.com",
    });
  });

  it("asks for the website in the card when it is missing", async () => {
    renderBrandDashboard({ designMd: null, websiteUrl: null });

    expect(
      screen.getByRole("textbox", {
        name: "Add a project website before generating brand context.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate from website" }),
    ).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    // Choosing Upload leaves no empty button row above the upload form.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start upload" })).toBeTruthy();
    expect(
      screen.getByTestId("project-brand-card").querySelector(".flex-wrap"),
    ).toBeNull();
    expect(
      screen.getByText(
        "Add a project website before generating brand context.",
      ),
    ).toBeInTheDocument();
  });

  it("lets the owner fix a saved website that generation could not use", async () => {
    const user = userEvent.setup();
    mockSavedWebsite();
    renderBrandDashboard({
      autoStart: false,
      designMd: null,
      websiteUrl: "https://bad.invalid/",
    });

    const field = screen.getByRole("textbox", {
      name: "Project website",
    });
    expect(field).toHaveValue("https://bad.invalid/");

    await user.clear(field);
    await submitWebsite(user, "springtea.example");

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith({
        projectId: "project-1",
        websiteUrl: "https://springtea.example/",
      }),
    );
    await waitFor(() =>
      expect(generateMock).toHaveBeenCalledWith({
        force: true,
        url: "https://springtea.example/",
      }),
    );
  });

  it("retries the saved website without saving it again", async () => {
    const user = userEvent.setup();
    renderBrandDashboard({
      autoStart: false,
      designMd: null,
      websiteUrl: "https://example.com/",
    });

    await user.click(
      screen.getByRole("button", { name: "Generate from website" }),
    );

    expect(updateProject).not.toHaveBeenCalled();
    expect(generateMock).toHaveBeenCalledWith({
      force: true,
      url: "https://example.com/",
    });
  });

  it("follows a refreshed saved website while the field is untouched", async () => {
    const user = userEvent.setup();
    const view = renderBrandDashboard({
      autoStart: false,
      designMd: null,
      websiteUrl: "https://old.example/",
    });

    view.rerenderWithWebsite("https://new.example/");
    expect(
      screen.getByRole("textbox", { name: "Project website" }),
    ).toHaveValue("https://new.example/");
    await user.click(
      screen.getByRole("button", { name: "Generate from website" }),
    );

    expect(updateProject).not.toHaveBeenCalled();
    expect(generateMock).toHaveBeenCalledWith({
      force: true,
      url: "https://new.example/",
    });
  });

  it("drops the saved draft, so a later refreshed website wins", async () => {
    const user = userEvent.setup();
    mockSavedWebsite();
    const view = renderBrandDashboard({
      autoStart: false,
      designMd: null,
      websiteUrl: "https://a.example/",
    });

    await user.clear(screen.getByRole("textbox", { name: "Project website" }));
    await submitWebsite(user, "b.example");
    await waitFor(() => expect(updateProject).toHaveBeenCalledOnce());

    view.rerenderWithWebsite("https://b.example/");
    view.rerenderWithWebsite("https://c.example/");
    expect(
      screen.getByRole("textbox", { name: "Project website" }),
    ).toHaveValue("https://c.example/");
    await user.click(
      screen.getByRole("button", { name: "Generate from website" }),
    );

    expect(updateProject).toHaveBeenCalledOnce();
    expect(generateMock).toHaveBeenLastCalledWith({
      force: true,
      url: "https://c.example/",
    });
  });

  it("keeps the typed website when saving it fails", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProject).mockRejectedValue(new Error("Forbidden"));
    const view = renderBrandDashboard({
      autoStart: false,
      designMd: null,
      websiteUrl: "https://a.example/",
    });

    await user.clear(screen.getByRole("textbox", { name: "Project website" }));
    await submitWebsite(user, "b.example");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to update project",
    );

    view.rerenderWithWebsite("https://a.example/");
    expect(
      screen.getByRole("textbox", { name: "Project website" }),
    ).toHaveValue("b.example");
  });

  it("saves only the website, then generates exactly once", async () => {
    const user = userEvent.setup();
    mockSavedWebsite();
    const view = renderBrandDashboard({ designMd: null, websiteUrl: null });

    await submitWebsite(user, "springtea.example");

    // No name: one from this render could undo a rename made meanwhile.
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith({
        projectId: "project-1",
        websiteUrl: "https://springtea.example/",
      }),
    );
    await waitFor(() =>
      expect(generateMock).toHaveBeenCalledWith({
        force: true,
        url: "https://springtea.example/",
      }),
    );

    view.rerenderWithWebsite("https://springtea.example/");
    await waitFor(() => expect(generateMock).toHaveBeenCalledOnce());
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("generates from a website saved after an existing brand was removed", async () => {
    const user = userEvent.setup();
    vi.mocked(removeProjectDesignMd).mockResolvedValue({
      projectId: "project-1",
    });
    mockSavedWebsite();
    const view = renderBrandDashboard({ websiteUrl: null });

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
    // Removing still suppresses the passive auto-start.
    expect(generateMock).not.toHaveBeenCalled();

    await submitWebsite(user, "example.com");
    await waitFor(() =>
      expect(generateMock).toHaveBeenCalledWith({
        force: true,
        url: "https://example.com/",
      }),
    );

    view.rerenderWithWebsite("https://example.com/");
    await waitFor(() => expect(generateMock).toHaveBeenCalledOnce());
  });

  it("shows the save error and skips generation when the update is refused", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProject).mockResolvedValue({
      ok: false,
      error: { kind: "identifier_invalid" },
    } as Awaited<ReturnType<typeof updateProject>>);
    renderBrandDashboard({ designMd: null, websiteUrl: null });

    await submitWebsite(user, "example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to update project",
    );
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("explains an invalid website without saving", async () => {
    const user = userEvent.setup();
    renderBrandDashboard({ designMd: null, websiteUrl: null });

    await user.type(screen.getByRole("textbox"), "acme");
    await user.click(
      screen.getByRole("button", { name: "Generate from website" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a website like example.com.",
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(updateProject).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("textbox"));
    await user.click(
      screen.getByRole("button", { name: "Generate from website" }),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("shows the save error in the card when the update fails", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProject).mockRejectedValue(new Error("Forbidden"));
    renderBrandDashboard({ designMd: null, websiteUrl: null });

    await user.type(screen.getByRole("textbox"), "example.com");
    await user.click(
      screen.getByRole("button", { name: "Generate from website" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to update project",
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("keeps the website hint, without a field, once a DESIGN.md is uploaded", () => {
    renderBrandDashboard({ websiteUrl: null });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByText(
        "Add a project website before generating brand context.",
      ),
    ).toBeInTheDocument();
  });

  it("blocks generate while a DESIGN.md upload is in flight", async () => {
    const user = userEvent.setup();
    renderBrandDashboard({ designMd: null });

    await user.click(screen.getByRole("button", { name: "Upload" }));
    // Generate stays reachable after choosing Upload, until a file is sent.
    expect(
      screen.getByRole("button", { name: "Generate from website" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Start upload" }));

    expect(
      screen.getByRole("button", { name: "Generate from website" }),
    ).toBeDisabled();
  });
});
