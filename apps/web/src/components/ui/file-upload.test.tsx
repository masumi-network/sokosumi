import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileUpload, FileUploadDropzone } from "./file-upload";

function selectFiles(container: HTMLElement, files: File[]): void {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("Expected file input");
  }
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  fireEvent.change(input);
}

describe("FileUpload", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the 2 s invalid reset timer on unmount", () => {
    vi.useFakeTimers();

    const { container, unmount } = render(
      <FileUpload accept="image/png">
        <FileUploadDropzone />
      </FileUpload>,
    );

    const badFile = new File(["text"], "notes.txt", { type: "text/plain" });
    selectFiles(container, [badFile]);

    const dropzone = screen.getByRole("region");
    expect(dropzone).toHaveAttribute("aria-invalid", "true");
    expect(dropzone).toHaveAttribute("data-invalid", "");
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets the dropzone to valid when hidden by Activity before 2 s and revealed", () => {
    vi.useFakeTimers();

    const ui = (
      <FileUpload accept="image/png">
        <FileUploadDropzone />
      </FileUpload>
    );

    const { container, rerender } = render(
      <Activity mode="visible">{ui}</Activity>,
    );

    const badFile = new File(["text"], "notes.txt", { type: "text/plain" });
    selectFiles(container, [badFile]);

    const dropzone = screen.getByRole("region");
    expect(dropzone).toHaveAttribute("aria-invalid", "true");
    expect(dropzone).toHaveAttribute("data-invalid", "");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(dropzone).toHaveAttribute("aria-invalid", "true");

    rerender(<Activity mode="hidden">{ui}</Activity>);
    expect(vi.getTimerCount()).toBe(0);

    rerender(<Activity mode="visible">{ui}</Activity>);
    const revealedDropzone = screen.getByRole("region");
    expect(revealedDropzone).toHaveAttribute("aria-invalid", "false");
    expect(revealedDropzone).not.toHaveAttribute("data-invalid");
  });

  it("uploads an accepted file exactly once in a controlled picker with an inline onValueChange", async () => {
    const onUpload = vi.fn();

    function ControlledPicker() {
      const [files, setFiles] = useState<File[]>([]);
      return (
        <FileUpload
          value={files}
          onValueChange={(nextFiles) => setFiles(nextFiles)}
          onUpload={onUpload}
          accept="image/png"
          maxFiles={1}
        >
          <FileUploadDropzone />
        </FileUpload>
      );
    }

    const { container } = render(<ControlledPicker />);
    const goodFile = new File(["png"], "logo.png", { type: "image/png" });
    selectFiles(container, [goodFile]);

    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith([goodFile], expect.any(Object));
  });

  it("resets the dropzone to valid after 2 s when kept visible", () => {
    vi.useFakeTimers();

    const { container } = render(
      <FileUpload accept="image/png">
        <FileUploadDropzone />
      </FileUpload>,
    );

    const badFile = new File(["text"], "notes.txt", { type: "text/plain" });
    selectFiles(container, [badFile]);

    const dropzone = screen.getByRole("region");
    expect(dropzone).toHaveAttribute("aria-invalid", "true");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(dropzone).toHaveAttribute("aria-invalid", "false");
    expect(dropzone).not.toHaveAttribute("data-invalid");
  });

  it("keeps each reject's 2 s visible deadline and clears all pending timers on hide or unmount", () => {
    vi.useFakeTimers();

    const { container, unmount } = render(
      <FileUpload accept="image/png">
        <FileUploadDropzone />
      </FileUpload>,
    );

    const badFile = new File(["text"], "notes.txt", { type: "text/plain" });
    selectFiles(container, [badFile]);

    const dropzone = screen.getByRole("region");
    expect(dropzone).toHaveAttribute("aria-invalid", "true");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(dropzone).toHaveAttribute("aria-invalid", "true");

    selectFiles(container, [badFile]);
    expect(dropzone).toHaveAttribute("aria-invalid", "true");
    expect(vi.getTimerCount()).toBe(2);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(dropzone).toHaveAttribute("aria-invalid", "false");
    expect(dropzone).not.toHaveAttribute("data-invalid");
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
