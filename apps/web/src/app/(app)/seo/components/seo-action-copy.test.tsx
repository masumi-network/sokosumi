import type { ProjectSeoAction } from "@sokosumi/core-client";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { useSeoActionInstructions } from "./seo-action-copy";

function instructions(
  before: string | null,
  target = "title",
  extra: Partial<ProjectSeoAction> = {},
) {
  const action: ProjectSeoAction = {
    id: "action-row",
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    pageUrl: "https://example.com/",
    findingIds: [],
    title: "Fix the page title",
    why: "The title is too long",
    effort: "low",
    expectedEffect: "A full title in search",
    edit: { target, before, after: "<title>Short</title>" },
    taskId: null,
    status: "recommended",
    kind: "fix",
    evidence: [],
    ...extra,
  };
  return renderHook(() => useSeoActionInstructions(action, action.why), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  }).result.current;
}

it("copies the recorded value as it is, before the suggested change", () => {
  expect(instructions("<title>A  long\ntitle</title>")).toContain(
    "What to change: title\n\nBefore:\n<title>A  long\ntitle</title>\n\nSuggested change:\n<title>Short</title>",
  );
});

it("leaves out a blank target", () => {
  expect(instructions("<title>Old</title>", " ")).not.toContain(
    "What to change",
  );
});

it("copies a checked opening text draft with its note, and nothing for a held-back one", () => {
  const devices = ["mobile" as const];
  expect(
    instructions("<title>Old</title>", "title", {
      bodyDraft: {
        target: "opening",
        devices,
        before: "Widgets for every room.",
        after: "Example Corp makes widgets for every room.",
      },
    }),
  ).toContain(
    "Current opening:\nWidgets for every room.\n\nSuggested opening:\nExample Corp makes widgets for every room.\n\nThe SEO bot checked",
  );
  expect(
    instructions("<title>Old</title>", "title", {
      bodyDraft: { target: "opening", devices, heldBack: "Names Acme." },
    }),
  ).not.toMatch(/opening|Names Acme/);
});
