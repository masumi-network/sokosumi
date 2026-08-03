import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignMdAdHocDialog } from "@/components/design-md/design-md-adhoc-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const startDesignMdGenerationMock = vi.fn();
const pollDesignMdGenerationMock = vi.fn();
const finalizeDesignMdGenerationMock = vi.fn();
vi.mock("@/lib/actions/design-md", () => ({
  startDesignMdGeneration: (...args: unknown[]) =>
    startDesignMdGenerationMock(...args),
  pollDesignMdGeneration: (...args: unknown[]) =>
    pollDesignMdGenerationMock(...args),
  finalizeDesignMdGeneration: (...args: unknown[]) =>
    finalizeDesignMdGenerationMock(...args),
}));

function renderDialog(onGenerated = vi.fn()) {
  const onOpenChange = vi.fn();
  const utils = render(
    <DesignMdAdHocDialog
      open
      onOpenChange={onOpenChange}
      onGenerated={onGenerated}
    />,
  );
  return { ...utils, onOpenChange, onGenerated };
}

describe("DesignMdAdHocDialog", () => {
  it("disables generation until a URL is entered", () => {
    renderDialog();

    expect(
      screen.getByRole("button", { name: "confirmGenerate" }),
    ).toBeDisabled();
  });

  it("rejects an empty URL submitted via Enter without disabling the button first", async () => {
    const user = userEvent.setup();
    renderDialog();

    // Enter submits regardless of the button's disabled state, so the
    // handler itself has to reject a blank/whitespace URL too.
    await user.type(screen.getByLabelText("adHocUrlLabel"), "   {Enter}");

    expect(toastErrorMock).toHaveBeenCalledWith("adHocMissingUrl");
    expect(startDesignMdGenerationMock).not.toHaveBeenCalled();
  });

  it("normalizes a bare domain to https:// and submits with the adhoc owner", async () => {
    const user = userEvent.setup();
    startDesignMdGenerationMock.mockResolvedValue({
      ok: true,
      data: {
        kind: "completed",
        data: { url: "https://blob.example/adhoc.md", extractionId: "1" },
      },
    });
    renderDialog();

    await user.type(screen.getByLabelText("adHocUrlLabel"), "competitor.com");
    await user.click(screen.getByRole("button", { name: "confirmGenerate" }));

    expect(startDesignMdGenerationMock).toHaveBeenCalledWith({
      force: undefined,
      owner: { type: "adhoc" },
      url: "https://competitor.com",
    });
  });

  it("calls onGenerated with the source URL once generation completes synchronously", async () => {
    const user = userEvent.setup();
    const onGenerated = vi.fn();
    startDesignMdGenerationMock.mockResolvedValue({
      ok: true,
      data: {
        kind: "completed",
        data: { url: "https://blob.example/adhoc.md", extractionId: "1" },
      },
    });
    const { onOpenChange } = renderDialog(onGenerated);

    await user.type(
      screen.getByLabelText("adHocUrlLabel"),
      "https://competitor.com",
    );
    await user.click(screen.getByRole("button", { name: "confirmGenerate" }));

    expect(onGenerated).toHaveBeenCalledWith({
      label: "DESIGN.md",
      url: "https://blob.example/adhoc.md",
      sourceUrl: "https://competitor.com",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccessMock).toHaveBeenCalledWith("generateSuccess");
  });

  it("polls and finalizes when generation is queued, without ever persisting to a profile", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onGenerated = vi.fn();
    startDesignMdGenerationMock.mockResolvedValue({
      ok: true,
      data: { kind: "queued", jobId: "job-1", jobToken: "token-1" },
    });
    pollDesignMdGenerationMock.mockResolvedValue({
      ok: true,
      data: { status: "done", extractionId: 1, designMd: "# Brand" },
    });
    finalizeDesignMdGenerationMock.mockResolvedValue({
      ok: true,
      data: { url: "https://blob.example/adhoc.md", extractionId: "1" },
    });
    renderDialog(onGenerated);

    await user.type(
      screen.getByLabelText("adHocUrlLabel"),
      "https://competitor.com",
    );
    await user.click(screen.getByRole("button", { name: "confirmGenerate" }));

    expect(startDesignMdGenerationMock).toHaveBeenCalledWith({
      force: undefined,
      owner: { type: "adhoc" },
      url: "https://competitor.com",
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(pollDesignMdGenerationMock).toHaveBeenCalledWith({
      jobId: "job-1",
      jobToken: "token-1",
      owner: { type: "adhoc" },
    });
    expect(finalizeDesignMdGenerationMock).toHaveBeenCalledWith({
      jobId: "job-1",
      jobToken: "token-1",
      owner: { type: "adhoc" },
    });
    expect(onGenerated).toHaveBeenCalledWith({
      label: "DESIGN.md",
      url: "https://blob.example/adhoc.md",
      sourceUrl: "https://competitor.com",
    });

    vi.useRealTimers();
  });

  it("shows the returned error message when generation fails", async () => {
    const user = userEvent.setup();
    startDesignMdGenerationMock.mockResolvedValue({
      ok: false,
      error: { message: "Could not reach that website" },
    });
    renderDialog();

    await user.type(
      screen.getByLabelText("adHocUrlLabel"),
      "https://competitor.com",
    );
    await user.click(screen.getByRole("button", { name: "confirmGenerate" }));

    expect(
      await screen.findByText("Could not reach that website"),
    ).toBeInTheDocument();
  });
});
