"use client";

import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  MentionTextarea,
  type MentionTextareaHandle,
} from "@/components/ui/mention-textarea";

function StatefulMentionTextarea({
  onChange,
  onSubmitShortcut,
  submitOnEnter = false,
}: {
  onChange?: (value: string) => void;
  onSubmitShortcut?: () => void;
  submitOnEnter?: boolean;
}) {
  const [value, setValue] = useState("");

  return (
    <MentionTextarea
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue);
        onChange?.(nextValue);
      }}
      mentions={{
        coworker_elena: {
          value: "Elena",
          slug: "elena",
        },
      }}
      submitOnEnter={submitOnEnter}
      onSubmitShortcut={onSubmitShortcut}
    />
  );
}

function ImperativeMentionTextarea({
  initialValue = "",
  onChange,
}: {
  initialValue?: string;
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<MentionTextareaHandle | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => textareaRef.current?.openMentions()}
      >
        mention
      </button>
      <MentionTextarea
        ref={textareaRef}
        value={value}
        onChange={(nextValue) => {
          setValue(nextValue);
          onChange(nextValue);
        }}
        mentions={{
          coworker_elena: {
            value: "Elena",
            slug: "elena",
          },
        }}
      />
    </>
  );
}

describe("MentionTextarea", () => {
  it("submits on Enter when submitOnEnter is enabled", () => {
    const onSubmitShortcut = vi.fn();

    render(
      <StatefulMentionTextarea
        submitOnEnter
        onSubmitShortcut={onSubmitShortcut}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
  });

  it("keeps Shift+Enter for multiline input", () => {
    const onSubmitShortcut = vi.fn();

    render(
      <StatefulMentionTextarea
        submitOnEnter
        onSubmitShortcut={onSubmitShortcut}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      shiftKey: true,
    });

    expect(onSubmitShortcut).not.toHaveBeenCalled();
  });

  it("opens mention suggestions from the imperative handle", () => {
    const onChange = vi.fn();

    render(<ImperativeMentionTextarea onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "mention" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Elena")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Elena"));

    expect(onChange).toHaveBeenLastCalledWith("@coworker_elena:elena ");
  });

  it("inserts manual mentions with spacing after existing text", () => {
    const onChange = vi.fn();

    render(<ImperativeMentionTextarea initialValue="Hello" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "mention" }));
    fireEvent.click(screen.getByText("Elena"));

    expect(onChange).toHaveBeenLastCalledWith("Hello @coworker_elena:elena ");
  });
});
