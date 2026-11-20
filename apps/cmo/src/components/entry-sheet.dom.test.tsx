// @vitest-environment happy-dom

import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";
import { EntrySheet } from "./entry-sheet";

// The sheet's entrance has nothing to animate in a test DOM.
vi.mock("motion/react", () => {
  const plain =
    (Tag: "div" | "aside") =>
    ({
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    }: Record<string, unknown>) => <Tag {...rest} />;
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: { div: plain("div"), aside: plain("aside") },
  };
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const baseEntry = {
  id: "cal-1",
  date: "2026-10-27",
  time: "12:00",
  channel: "youtube",
  format: "short",
  title: "Trace a request through a workflow",
  status: "draft" as const,
  draft: "Original copy.",
};

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("EntrySheet PostPreview", () => {
  it("keeps the video element mounted when saving edited post copy", async () => {
    const overview = cmoOverview();
    function Harness() {
      const [draft, setDraft] = useState(baseEntry.draft);
      return (
        <EntrySheet
          entry={{ ...baseEntry, draft }}
          media={{
            entryId: "cal-1",
            kind: "video",
            url: "https://blob/v.mp4",
          }}
          overview={overview}
          onClose={() => {}}
          onEdit={async (next) => {
            setDraft(next);
            return null;
          }}
        />
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });

    const videoBefore = host.querySelector("video");
    expect(videoBefore).not.toBeNull();

    const editButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Edit text",
    );
    expect(editButton).toBeDefined();
    await act(async () => {
      editButton?.click();
    });

    const textarea = host.querySelector("textarea");
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (textarea) setNativeTextareaValue(textarea, "Updated copy.");
    });

    const saveButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
    expect(saveButton).toBeDefined();
    await act(async () => {
      saveButton?.click();
    });

    const videoAfter = host.querySelector("video");
    expect(videoAfter).toBe(videoBefore);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("Updated copy.");

    // Reopening the editor shows the saved words, not the previous ones.
    const editAgainButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Edit text",
    );
    await act(async () => {
      editAgainButton?.click();
    });
    expect(host.querySelector("textarea")?.value).toBe("Updated copy.");
  });

  it("handles Escape and arrow keys, skipping arrows while typing in the edit textarea", async () => {
    const overview = cmoOverview();
    const onClose = vi.fn();
    const onPrev = vi.fn();
    const onNext = vi.fn();

    await act(async () => {
      root.render(
        <EntrySheet
          entry={baseEntry}
          overview={overview}
          onClose={onClose}
          onPrev={onPrev}
          onNext={onNext}
          onEdit={async () => null}
        />,
      );
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);

    // Open the edit textarea: arrows stay with the editor, Escape still closes.
    const editButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Edit text",
    );
    await act(async () => {
      editButton?.click();
    });
    const textarea = host.querySelector("textarea");
    expect(textarea).not.toBeNull();

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
