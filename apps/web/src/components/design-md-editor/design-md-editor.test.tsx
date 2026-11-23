import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";

import { DesignMdEditor } from "./design-md-editor";

// The App Router as the edit page sees it: the Edit menu item pushes the edit
// route (a new bfcacheId), Cancel pushes back to the profile.
const nav = vi.hoisted(() => ({
  pathname: "/organizations/acme/design-md/edit",
  bfcacheId: "open-1",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, bfcacheId: nav.bfcacheId }),
}));

vi.mock("@/lib/actions/design-md/action", () => ({
  saveDesignMdUpload: vi.fn(),
}));

// A plain field in place of the rich editor, which happy-dom cannot drive.
// Its Cancel leaves at once: the Discard dialog lives in the real editor and
// is covered by `e2e/organization-design-md.test.ts`.
vi.mock("./full-page-markdown-editor", () => ({
  FullPageMarkdownEditor: ({
    onCancel,
    onValueChange,
    value,
  }: {
    onCancel: () => void;
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <>
      <textarea
        aria-label="Edit DESIGN.md"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </>
  ),
}));

function EditRoute() {
  // Next hides a route the reader left instead of unmounting it.
  const mode = nav.pathname.endsWith("/edit") ? "visible" : "hidden";
  return (
    <StrictMode>
      <NextIntlClientProvider locale="en" messages={en}>
        <Activity mode={mode}>
          <DesignMdEditor
            initialMarkdown="# Saved brand"
            owner={{ type: "organization", organizationId: "org-1" }}
            returnHref="/organizations/acme"
          />
        </Activity>
      </NextIntlClientProvider>
    </StrictMode>
  );
}

beforeEach(() => {
  nav.pathname = "/organizations/acme/design-md/edit";
  nav.bfcacheId = "open-1";
  nav.push.mockImplementation((path: string) => {
    nav.pathname = path;
  });
});

describe("DesignMdEditor", () => {
  it("opens from the saved file on a new visit, not from the left draft", () => {
    const { rerender } = render(<EditRoute />);
    fireEvent.change(screen.getByLabelText("Edit DESIGN.md"), {
      target: { value: "# Saved brand\n\nDISCARDED" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(nav.push).toHaveBeenCalledWith("/organizations/acme");
    rerender(<EditRoute />);

    nav.pathname = "/organizations/acme/design-md/edit";
    nav.bfcacheId = "open-2";
    rerender(<EditRoute />);

    expect(screen.getByLabelText("Edit DESIGN.md")).toHaveValue(
      "# Saved brand",
    );
  });

  it("keeps the edit while the same visit re-renders", () => {
    const { rerender } = render(<EditRoute />);
    fireEvent.change(screen.getByLabelText("Edit DESIGN.md"), {
      target: { value: "# Saved brand\n\nDraft" },
    });

    rerender(<EditRoute />);

    expect(screen.getByLabelText("Edit DESIGN.md")).toHaveValue(
      "# Saved brand\n\nDraft",
    );
  });
});
