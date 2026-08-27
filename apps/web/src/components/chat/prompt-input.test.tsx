"use client";

import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/chat/prompt-input";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function StatefulPromptComposer({
  onSubmit,
  allowEnterToSubmitOnMobile,
}: {
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  allowEnterToSubmitOnMobile?: boolean;
}) {
  const [value, setValue] = useState("hello");

  return (
    <PromptInput
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(event);
      }}
    >
      <PromptInputTextarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        allowEnterToSubmitOnMobile={allowEnterToSubmitOnMobile}
      />
      <PromptInputSubmit />
    </PromptInput>
  );
}

describe("PromptInputTextarea", () => {
  it("submits on plain Enter", () => {
    const onSubmit = vi.fn();

    render(<StatefulPromptComposer onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit on Shift+Enter", () => {
    const onSubmit = vi.fn();

    render(<StatefulPromptComposer onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      shiftKey: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("inserts a newline on Cmd+Enter without submitting", () => {
    const onSubmit = vi.fn();

    render(<StatefulPromptComposer onSubmit={onSubmit} />);

    const textarea = screen.getByRole("textbox");
    textarea.focus();
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);

    fireEvent.keyDown(textarea, {
      key: "Enter",
      metaKey: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe("hello\n");
  });

  it("inserts a newline on Ctrl+Enter without submitting", () => {
    const onSubmit = vi.fn();

    render(<StatefulPromptComposer onSubmit={onSubmit} />);

    const textarea = screen.getByRole("textbox");
    textarea.focus();
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);

    fireEvent.keyDown(textarea, {
      key: "Enter",
      ctrlKey: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe("hello\n");
  });

  it("does not submit on Enter on a narrow viewport when mobile submit is disabled", () => {
    const onSubmit = vi.fn();
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });

    try {
      render(
        <StatefulPromptComposer
          onSubmit={onSubmit}
          allowEnterToSubmitOnMobile={false}
        />,
      );

      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });
});
