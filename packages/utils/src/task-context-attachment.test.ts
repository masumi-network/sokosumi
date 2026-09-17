import { describe, expect, it } from "vitest";

import {
  isTaskContextAttachmentLabel,
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
  parseTaskContextFromDescription,
  removeTaskContextAttachmentLinks,
  taskContextSelectionAttachesAnything,
  taskContextSelectionResolvesAnything,
} from "./task-context-attachment.js";

describe("removeTaskContextAttachmentLinks", () => {
  it("exposes the project file labels", () => {
    expect(PROJECT_BRIEFING_ATTACHMENT_LABEL).toBe("BRIEFING.md");
    expect(PROJECT_CONTEXT_MD_ATTACHMENT_LABEL).toBe("CONTEXT.md");
  });

  it("identifies Context-owned attachment labels", () => {
    expect(isTaskContextAttachmentLabel("DESIGN.md")).toBe(true);
    expect(isTaskContextAttachmentLabel("BRIEFING.md")).toBe(true);
    expect(isTaskContextAttachmentLabel("CONTEXT.md")).toBe(true);
    expect(isTaskContextAttachmentLabel("notes.pdf")).toBe(false);
  });

  it("removes DESIGN.md, BRIEFING.md and CONTEXT.md links", () => {
    const markdown = [
      "[DESIGN.md](https://blob.example/design.md)",
      "",
      "[BRIEFING.md](https://blob.example/projects/p1/BRIEFING.md)",
      "",
      "[CONTEXT.md](https://blob.example/projects/p1/CONTEXT.md)",
      "",
      "Draft the LinkedIn launch post",
    ].join("\n");

    expect(removeTaskContextAttachmentLinks(markdown)).toBe(
      "Draft the LinkedIn launch post",
    );
  });

  it("leaves other links untouched", () => {
    const markdown = "[notes.pdf](https://blob.example/notes.pdf)\n\nBody";
    expect(removeTaskContextAttachmentLinks(markdown)).toBe(markdown);
  });
});

describe("parseTaskContextFromDescription", () => {
  const projectDesignMdUrl =
    "https://blob.example/design-md/projects/p1/hash.md";
  const workspaceDesignMdUrl =
    "https://blob.example/design-md/organizations/org1/hash.md";
  const adHocDesignMdUrl =
    "https://blob.example/design-md/adhoc/user-1/hash.md";
  const briefingUrl = "https://blob.example/projects/p1/BRIEFING.md";
  const contextMdUrl = "https://blob.example/projects/p1/CONTEXT.md";

  it("derives selection from stored Context links and returns stripped body", () => {
    const markdown = [
      `[DESIGN.md](${projectDesignMdUrl})`,
      `[BRIEFING.md](${briefingUrl})`,
      `[CONTEXT.md](${contextMdUrl})`,
      "",
      "Draft the LinkedIn launch post",
    ].join("\n");

    expect(
      parseTaskContextFromDescription(markdown, {
        projectDesignMdUrl,
        workspaceDesignMdUrl,
        adHocPathPrefix: "design-md/adhoc/user-1/",
      }),
    ).toEqual({
      body: "Draft the LinkedIn launch post",
      selection: {
        brandEnabled: true,
        brandSource: "project",
        brandUrl: projectDesignMdUrl,
        briefingEnabled: true,
        memoryEnabled: true,
      },
    });
  });

  it("marks missing Context files as off instead of inventing create defaults", () => {
    expect(
      parseTaskContextFromDescription("Just the prose", {
        projectDesignMdUrl,
        workspaceDesignMdUrl,
      }),
    ).toEqual({
      body: "Just the prose",
      selection: {
        brandEnabled: false,
        // Source still prefers project when available so re-enabling Brand
        // attaches the project DESIGN.md, matching create chip behavior.
        brandSource: "project",
        brandUrl: null,
        briefingEnabled: false,
        memoryEnabled: false,
      },
    });
  });

  it("maps workspace brand URL to default source and ad-hoc URL to custom", () => {
    expect(
      parseTaskContextFromDescription(
        `[DESIGN.md](${workspaceDesignMdUrl})\n\nBody`,
        {
          projectDesignMdUrl,
          workspaceDesignMdUrl,
          adHocPathPrefix: "design-md/adhoc/user-1/",
        },
      ).selection,
    ).toMatchObject({
      brandEnabled: true,
      brandSource: "default",
      brandUrl: workspaceDesignMdUrl,
    });

    expect(
      parseTaskContextFromDescription(
        `[DESIGN.md](${adHocDesignMdUrl})\n\nBody`,
        {
          projectDesignMdUrl,
          workspaceDesignMdUrl,
          adHocPathPrefix: "design-md/adhoc/user-1/",
        },
      ).selection,
    ).toMatchObject({
      brandEnabled: true,
      brandSource: "custom",
      brandUrl: adHocDesignMdUrl,
    });
  });

  it("remaps stale DESIGN.md URLs onto live project or workspace sources", () => {
    const staleUrl = "https://blob.example/design-md/projects/old/hash.md";

    expect(
      parseTaskContextFromDescription(`[DESIGN.md](${staleUrl})\n\nBody`, {
        projectDesignMdUrl,
        workspaceDesignMdUrl,
        adHocPathPrefix: "design-md/adhoc/user-1/",
      }).selection,
    ).toMatchObject({
      brandEnabled: true,
      brandSource: "project",
      brandUrl: staleUrl,
    });

    expect(
      parseTaskContextFromDescription(`[DESIGN.md](${staleUrl})\n\nBody`, {
        workspaceDesignMdUrl,
        adHocPathPrefix: "design-md/adhoc/user-1/",
      }).selection,
    ).toMatchObject({
      brandEnabled: true,
      brandSource: "default",
      brandUrl: staleUrl,
    });
  });
});

describe("taskContextSelectionAttachesAnything", () => {
  const enabledBrand = {
    brand: { enabled: true, source: "project" as const, custom: null },
    briefingEnabled: false,
    contextMdEnabled: false,
  };

  it("returns true when any chip is enabled", () => {
    expect(taskContextSelectionAttachesAnything(enabledBrand)).toBe(true);
    expect(
      taskContextSelectionAttachesAnything({
        brand: { enabled: false },
        briefingEnabled: false,
        contextMdEnabled: false,
      }),
    ).toBe(false);
  });
});

describe("taskContextSelectionResolvesAnything", () => {
  const enabledBrand = {
    brand: { enabled: true, source: "project" as const, custom: null },
    briefingEnabled: false,
    contextMdEnabled: false,
  };

  it("requires a resolvable URL for each enabled chip", () => {
    expect(
      taskContextSelectionResolvesAnything(enabledBrand, {
        projectDesignMdUrl: null,
        workspaceDesignMdUrl: null,
      }),
    ).toBe(false);

    expect(
      taskContextSelectionResolvesAnything(enabledBrand, {
        workspaceDesignMdUrl: "https://blob.example/design.md",
      }),
    ).toBe(true);

    expect(
      taskContextSelectionResolvesAnything(
        {
          brand: { enabled: false },
          briefingEnabled: true,
          contextMdEnabled: false,
        },
        { projectBriefingUrl: null },
      ),
    ).toBe(false);

    expect(
      taskContextSelectionResolvesAnything(
        {
          brand: {
            enabled: true,
            source: "custom",
            custom: { url: "https://blob.example/adhoc.md" },
          },
          briefingEnabled: false,
          contextMdEnabled: false,
        },
        {},
      ),
    ).toBe(true);
  });
});
