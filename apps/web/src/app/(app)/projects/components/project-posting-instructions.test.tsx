import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectPostingInstructions } from "@/app/projects/components/project-posting-instructions";
import { updateProjectPostingInstructions } from "@/lib/actions/project/action";

vi.mock("@/lib/actions/project/action", () => ({
  updateProjectPostingInstructions: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

describe("ProjectPostingInstructions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the saved instructions and the structure template", () => {
    render(
      <ProjectPostingInstructions
        projectId={PROJECT_ID}
        postingInstructionsMd="Tone: warm"
      />,
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("Tone: warm");
    expect(input).toHaveAttribute("placeholder", "placeholder");
    expect(screen.getByText("description")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("saves edited instructions", async () => {
    vi.mocked(updateProjectPostingInstructions).mockResolvedValue({
      ok: true,
      value: { postingInstructionsMd: "Tone: playful" },
    });
    render(
      <ProjectPostingInstructions
        projectId={PROJECT_ID}
        postingInstructionsMd={null}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Tone: playful" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("saved");
    });
    expect(updateProjectPostingInstructions).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      postingInstructionsMd: "Tone: playful",
    });
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("reports a failed save and keeps the draft", async () => {
    vi.mocked(updateProjectPostingInstructions).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" } as never,
    });
    render(
      <ProjectPostingInstructions
        projectId={PROJECT_ID}
        postingInstructionsMd={null}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Never use emojis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("saveFailed");
    });
    expect(screen.getByRole("textbox")).toHaveValue("Never use emojis");
  });

  it("is read-only for a closed project", () => {
    render(
      <ProjectPostingInstructions
        projectId={PROJECT_ID}
        postingInstructionsMd="Tone: warm"
        disabled
      />,
    );

    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
