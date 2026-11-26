import type { ProjectSeoAction } from "@sokosumi/core-client";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { useSeoActionInstructions } from "./seo-action-copy";

function instructions(before: string | null) {
  const action = {
    title: "Fix the page title",
    pageUrl: "https://example.com/",
    why: "The title is too long",
    expectedEffect: "A full title in search",
    evidence: [],
    edit: { target: "title", before, after: "<title>Short</title>" },
  } as unknown as ProjectSeoAction;
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

it("says in words that a blank value was not recorded", () => {
  expect(instructions("  \n")).toContain(
    "Before:\nNo previous value recorded\n\nSuggested change:",
  );
});
