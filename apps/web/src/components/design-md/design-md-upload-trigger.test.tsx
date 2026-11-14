import { fireEvent, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveDesignMdUpload } from "@/lib/actions/design-md/action";

import { DesignMdUploadTrigger } from "./design-md-upload-trigger";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/design-md/action", () => ({
  saveDesignMdUpload: vi.fn(),
}));

function chooseFile(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not rendered");
  fireEvent.change(input, { target: { files: [file] } });
}

describe("DesignMdUploadTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says an empty file is empty instead of sending it", async () => {
    const { container } = render(
      <DesignMdUploadTrigger owner={{ type: "project", projectId: "p1" }} />,
    );

    chooseFile(
      container,
      new File(["  \n"], "DESIGN.md", { type: "text/markdown" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("uploadEmpty"),
    );
    expect(saveDesignMdUpload).not.toHaveBeenCalled();
  });
});
