import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { EmailCodeField } from "./email-code-field";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

/** The field is controlled; this holds its value the way every page does. */
function Field({
  onComplete,
  initialCode = "",
}: {
  onComplete: (code: string) => void;
  initialCode?: string;
}) {
  const [code, setCode] = useState(initialCode);
  return (
    <EmailCodeField
      value={code}
      onChange={setCode}
      onComplete={onComplete}
      sentAt={0}
      onResend={vi.fn()}
      isResending={false}
    />
  );
}

function codeField() {
  return screen.getByRole("textbox", { name: "codeLabel" });
}

describe("EmailCodeField", () => {
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
});
