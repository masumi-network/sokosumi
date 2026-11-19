import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";

import { FullPageMarkdownEditor } from "./full-page-markdown-editor";

const LABELS = {
  cancel: "Cancel",
  discardConfirm: "Discard changes",
  discardDialogDescription: "Your edits will be lost.",
  discardDialogTitle: "Discard changes?",
  editTab: "Edit",
  previewTab: "Preview",
  save: "Save",
  title: "Edit DESIGN.md",
};

describe("FullPageMarkdownEditor", () => {
  it("names the editor after the page, so a screen reader says what it edits", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <FullPageMarkdownEditor
          initialValue="# Brand"
          isSaving={false}
          labels={LABELS}
          onCancel={vi.fn()}
          onSave={vi.fn()}
          onValueChange={vi.fn()}
          value="# Brand"
        />
      </NextIntlClientProvider>,
    );

    // One editor per layout: the wide two-pane view and the phone tabs.
    for (const editor of screen.getAllByRole("textbox", { hidden: true })) {
      expect(editor).toHaveAccessibleName("Edit DESIGN.md");
    }
  });
});
