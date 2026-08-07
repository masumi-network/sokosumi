import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editChannelDialogSource = readFileSync(
  join(import.meta.dirname, "../edit-channel-dialog.tsx"),
  "utf8",
);

const participantCheckboxesSource = readFileSync(
  join(import.meta.dirname, "../participant-checkboxes.tsx"),
  "utf8",
);

describe("edit channel mobile layout", () => {
  it("drops dialog horizontal padding one step and clips overflow", () => {
    expect(editChannelDialogSource).toContain("px-5 py-6");
    expect(editChannelDialogSource).toContain("overflow-x-hidden");
    expect(editChannelDialogSource).toContain("min-w-0");
    expect(editChannelDialogSource).not.toMatch(
      /DialogContent className="[^"]*\bp-6\b/,
    );
  });

  it("keeps participant roster width constrained on narrow dialogs", () => {
    expect(participantCheckboxesSource).toContain("shrinkContent");
    expect(participantCheckboxesSource).toContain(
      'className="min-w-0 overflow-hidden rounded-lg border bg-background"',
    );
    expect(participantCheckboxesSource).toContain('className="shrink-0"');
  });
});
