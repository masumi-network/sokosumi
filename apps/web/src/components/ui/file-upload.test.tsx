import { fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { describe, expect, it, vi } from "vitest";
import { FileUpload, FileUploadDropzone } from "./file-upload";

describe("FileUpload", () => {
  it("clears the invalid state when hidden by Activity before the 2s reset timer fires", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <Activity mode="visible">
          <FileUpload maxSize={5}>
            <FileUploadDropzone>Drop files</FileUploadDropzone>
          </FileUpload>
        </Activity>,
      );

      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const dropzone = screen.getByRole("region");
      const tooLarge = new File(["0123456789"], "large.txt", {
        type: "text/plain",
      });

      fireEvent.change(input, { target: { files: [tooLarge] } });
      expect(dropzone).toHaveAttribute("aria-invalid", "true");
      expect(dropzone).toHaveAttribute("data-invalid", "");
      expect(vi.getTimerCount()).toBe(1);

      rerender(
        <Activity mode="hidden">
          <FileUpload maxSize={5}>
            <FileUploadDropzone>Drop files</FileUploadDropzone>
          </FileUpload>
        </Activity>,
      );
      expect(vi.getTimerCount()).toBe(0);

      rerender(
        <Activity mode="visible">
          <FileUpload maxSize={5}>
            <FileUploadDropzone>Drop files</FileUploadDropzone>
          </FileUpload>
        </Activity>,
      );

      const restoredDropzone = screen.getByRole("region");
      expect(restoredDropzone).toHaveAttribute("aria-invalid", "false");
      expect(restoredDropzone).not.toHaveAttribute("data-invalid");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending upload progress animation frame on unmount", async () => {
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    let triggerProgress: ((file: File, progress: number) => void) | undefined;
    const uploadStarted = Promise.withResolvers<void>();

    const { container, unmount } = render(
      <FileUpload
        onUpload={(_files, { onProgress }) => {
          triggerProgress = onProgress;
          uploadStarted.resolve();
        }}
      >
        <FileUploadDropzone>Drop files</FileUploadDropzone>
      </FileUpload>,
    );

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["ok"], "ok.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    await uploadStarted.promise;

    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockReturnValue(42);
    try {
      triggerProgress?.(file, 40);
      unmount();
      expect(cancelSpy).toHaveBeenCalledWith(42);
    } finally {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    }
  });
});
