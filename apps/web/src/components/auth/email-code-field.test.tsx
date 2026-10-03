import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type Ref, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { EmailCodeInput, useEmailCodeRefusal } from "./email-code-field";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

/** The field is controlled; this holds its value the way every page does. */
function Field({
  onComplete = vi.fn(),
  initialCode = "",
  error,
  disabled,
  inputRef,
}: {
  onComplete?: (code: string) => void;
  initialCode?: string;
  error?: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [code, setCode] = useState(initialCode);
  return (
    <>
      <EmailCodeInput
        value={code}
        onChange={setCode}
        onComplete={onComplete}
        invalid={Boolean(error)}
        describedBy={error ? "code-error" : undefined}
        disabled={disabled}
        inputRef={inputRef}
      />
      {error ? <p id="code-error">{error}</p> : null}
    </>
  );
}

/** A page that refuses every code it is handed, as Better Auth can. */
function RefusingField({ onComplete }: { onComplete: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const refusal = useEmailCodeRefusal({
    isLocked: false,
    clear: () => setCode(""),
    focus: () => inputRef.current?.focus(),
  });
  return (
    <>
      <EmailCodeInput
        inputRef={inputRef}
        value={code}
        completedCodeRef={refusal.completedCodeRef}
        onChange={(next) => {
          setCode(next);
          setError(undefined);
        }}
        onComplete={(completed) => {
          onComplete(completed);
          setError(refusal.refuse({ code: "INVALID_OTP" }));
        }}
        invalid={Boolean(error)}
        describedBy={error ? "code-error" : undefined}
      />
      {error ? <p id="code-error">{error}</p> : null}
    </>
  );
}

function codeField() {
  return screen.getByRole("textbox", { name: "codeLabel" });
}

function slots() {
  return Array.from(
    document.querySelectorAll('[data-slot="input-otp-slot"]'),
    (slot) => slot.textContent,
  );
}

describe("EmailCodeInput", () => {
  it("is named for a screen reader without a visible label", () => {
    render(<Field />);

    expect(codeField()).toBeVisible();
    expect(screen.queryByText("codeLabel")).not.toBeInTheDocument();
    expect(document.querySelector("label")).toBeNull();
  });

  it("asks for six digits with the one-time-code keyboard", () => {
    render(<Field />);

    const field = codeField();
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    expect(field).toHaveAttribute("maxlength", "6");
    expect(slots()).toEqual(["", "", "", "", "", ""]);
  });

  it("keeps the drawn slots out of the accessibility tree, so the code is read once", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.type(codeField(), "0429");

    for (const slot of document.querySelectorAll(
      '[data-slot="input-otp-slot"]',
    )) {
      expect(slot).toHaveAttribute("aria-hidden", "true");
    }
    expect(codeField()).toHaveValue("0429");
  });

  it("shows each typed digit in its own slot and drops anything else", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.type(codeField(), "0a4 2-9");

    expect(codeField()).toHaveValue("0429");
    expect(slots()).toEqual(["0", "4", "2", "9", "", ""]);
  });

  it("fills all six slots from a pasted code", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.click(codeField());
    await user.paste("042 917");

    expect(slots()).toEqual(["0", "4", "2", "9", "1", "7"]);
  });

  it("hands over the code once the sixth digit is typed", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Field onComplete={onComplete} />);

    await user.type(codeField(), "04291");
    expect(onComplete).not.toHaveBeenCalled();

    await user.type(codeField(), "7");
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("042917");
  });

  it.each(["042 917", "042-917"])(
    "hands over a pasted %s as its digits",
    async (pasted) => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      render(<Field onComplete={onComplete} />);

      await user.click(codeField());
      await user.paste(pasted);

      expect(onComplete).toHaveBeenCalledExactlyOnceWith("042917");
    },
  );

  it("replaces a whole code already in the field with a pasted one", async () => {
    // The caret sits on the last slot of a full field, so pasting there
    // would keep five old digits and add one new one.
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Field onComplete={onComplete} initialCode="000000" />);

    await user.click(codeField());
    await user.paste("042-917");

    expect(codeField()).toHaveValue("042917");
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("042917");
  });

  it("hands over the same code only once, and a changed one again", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Field onComplete={onComplete} />);

    await user.type(codeField(), "000000");
    // Typing past six digits keeps the code as it is.
    await user.type(codeField(), "1");
    // Taking a digit back and typing it again is still the refused code.
    await user.type(codeField(), "{Backspace}0");
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("000000");

    await user.type(codeField(), "{Backspace}7");
    expect(onComplete).toHaveBeenLastCalledWith("000007");
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it("does not hand over a code it opens on again", async () => {
    // A step switch remounts the field over a code that was already sent.
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Field onComplete={onComplete} initialCode="000000" />);

    await user.type(codeField(), "{Backspace}0");

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("takes no input while disabled", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Field onComplete={onComplete} disabled />);

    expect(codeField()).toBeDisabled();
    await user.type(codeField(), "042917");

    expect(codeField()).toHaveValue("");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("is described by the page's reason once there is one", () => {
    const { rerender } = render(<Field />);
    expect(codeField()).not.toHaveAttribute("aria-invalid");
    expect(codeField()).not.toHaveAccessibleDescription();

    rerender(<Field error="That code is wrong." />);

    expect(codeField()).toHaveAttribute("aria-invalid", "true");
    expect(codeField()).toHaveAccessibleDescription("That code is wrong.");
  });

  it("hands its input to the page's ref, so the page can focus it again", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Field inputRef={ref} />);

    ref.current?.focus();

    expect(codeField()).toHaveFocus();
  });

  it("empties itself after a refused code and hands the same code over again", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<RefusingField onComplete={onComplete} />);

    await user.type(codeField(), "000000");

    expect(onComplete).toHaveBeenCalledExactlyOnceWith("000000");
    expect(codeField()).toHaveValue("");
    expect(codeField()).toHaveAccessibleDescription(/invalid$/);

    // The reason stays until the next code is typed.
    await user.type(codeField(), "0");
    expect(codeField()).not.toHaveAttribute("aria-invalid");

    await user.type(codeField(), "00000");
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith("000000");
  });
});
