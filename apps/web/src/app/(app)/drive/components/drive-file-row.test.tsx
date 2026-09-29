import type { FileResource } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriveFileRow } from "@/app/drive/components/drive-file-row";

/**
 * What a file row says about a document, and where it says it.
 *
 * Asserted by rendering. The sibling a11y suite reads the panel's source
 * because it claims something about what the panel never renders; these are
 * claims about what a row does render and *where*, and a regex over JSX cannot
 * tell "beside the name" from "below it". The row lives in its own file so it
 * can be mounted without the filter sheet, the collections shelf and the search
 * client the panel carries — a worker asked to mount the whole panel hangs.
 */

vi.mock("next-intl", () => ({
  // The key itself, so a case asserting a label cannot pass on a missing
  // translation quietly falling back to something readable.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "name" in values ? `${key}:${values.name}` : key,
  useFormatter: () => ({ relativeTime: () => "2 weeks ago" }),
}));

type Label = FileResource["tags"][number];

function label(displayName: string, overrides: Partial<Label> = {}): Label {
  return {
    id: `fl-${displayName}`,
    labelId: `wl-${displayName}`,
    kind: "TAG",
    displayName,
    state: "CONFIRMED",
    provenance: "MODEL",
    evidenceSnippet: null,
    stale: false,
    ...overrides,
  } as Label;
}

function resource(overrides: Partial<FileResource> = {}): FileResource {
  return {
    id: "res-1",
    displayName: "quarterly-report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    sourceKind: "DRIVE_UPLOAD",
    sourceTaskId: null,
    sourceProjectId: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    contentRevision: 1,
    metadataRevision: 1,
    extractionState: "INDEXED",
    extractionCoverage: 1,
    extractionReason: null,
    folderPath: null,
    category: null,
    tags: [],
    suggestions: [],
    rejected: [],
    projects: [],
    snippet: null,
    relatedReason: null,
    filenameMatch: false,
    ...overrides,
  } as FileResource;
}

function renderRow(item: FileResource) {
  return render(
    <ul>
      <DriveFileRow
        item={item}
        viewMode="list"
        selected={false}
        onToggle={() => undefined}
      />
    </ul>,
  );
}

describe("the label chips", () => {
  it("sit beside the name, on its line", () => {
    renderRow(
      resource({
        category: label("Report or analysis", { kind: "CATEGORY" }),
        tags: [label("Finance"), label("Legal")],
      }),
    );

    // One line carries the name and what the document is about. They were a
    // row of their own below it, which reads as metadata about the row.
    const nameRow = screen.getByTestId("drive-file-name-row");
    expect(
      within(nameRow).getByRole("link", { name: "quarterly-report.pdf" }),
    ).toBeVisible();
    expect(within(nameRow).getByText("Report or analysis")).toBeVisible();
    expect(within(nameRow).getByText("Finance")).toBeVisible();
    expect(within(nameRow).getByText("Legal")).toBeVisible();
  });

  it("counts the labels it did not show", () => {
    renderRow(
      resource({
        tags: [
          label("Finance"),
          label("Legal"),
          label("Design"),
          label("Product"),
          label("Ops"),
        ],
      }),
    );

    const nameRow = screen.getByTestId("drive-file-name-row");
    expect(within(nameRow).getByText("Finance")).toBeVisible();
    expect(within(nameRow).getByText("Legal")).toBeVisible();
    expect(within(nameRow).getByText("Design")).toBeVisible();
    expect(within(nameRow).getByText("+2")).toBeVisible();
    // Not rendered and not silently dropped: the count is the promise that the
    // other two exist.
    expect(within(nameRow).queryByText("Product")).toBeNull();
  });

  it("shows a model's tag as a tag, not as a dashed suggestion", () => {
    /**
     * The whole point of the change. Nothing promotes a label to CONFIRMED any
     * more, so a dashed "Suggested: X" treatment was the permanent rendering of
     * every tag the product produces — and only the first one, with the rest
     * invisible.
     */
    renderRow(
      resource({
        category: label("Contract", { kind: "CATEGORY", state: "SUGGESTED" }),
        tags: [
          label("Finance", { state: "SUGGESTED" }),
          label("Legal", { state: "SUGGESTED" }),
        ],
      }),
    );

    const nameRow = screen.getByTestId("drive-file-name-row");
    expect(within(nameRow).getByText("Contract")).toBeVisible();
    expect(within(nameRow).getByText("Finance")).toBeVisible();
    expect(within(nameRow).getByText("Legal")).toBeVisible();
    expect(within(nameRow).queryByText("suggestedChip:Finance")).toBeNull();
  });

  it("offers a dismissal only where there is a way back, and only for a model's label", () => {
    const onDismissLabel = vi.fn();
    const { unmount } = render(
      <ul>
        <DriveFileRow
          item={resource({
            tags: [
              label("Finance", { state: "SUGGESTED" }),
              label("Legal", { state: "CONFIRMED" }),
            ],
          })}
          viewMode="list"
          selected={false}
          onToggle={() => undefined}
          onDismissLabel={onDismissLabel}
        />
      </ul>,
    );

    // A label a person agreed with is not the model's to take back.
    expect(screen.queryByLabelText("removeTag:Legal")).toBeNull();
    screen.getByLabelText("removeTag:Finance").click();
    expect(onDismissLabel).toHaveBeenCalledTimes(1);
    unmount();

    // And no X at all where the caller cannot undo it. A dismissal also bars
    // the model from proposing the label again, so an unrecoverable one is
    // worse than none.
    renderRow(resource({ tags: [label("Finance", { state: "SUGGESTED" })] }));
    expect(screen.queryByLabelText("removeTag:Finance")).toBeNull();
  });
});

describe("where the document came from", () => {
  it("names every source except the one that is the default", () => {
    // Reporting a table, a studio asset or a project document as an "upload"
    // would be a quiet lie about the reader's file, so each of those is named.
    for (const kind of [
      "TASK_OUTPUT",
      "PROJECT_DOCUMENT",
      "NATIVE_TABLE",
      "STUDIO_ASSET",
    ] as const) {
      const { unmount } = renderRow(resource({ sourceKind: kind }));
      expect(screen.getByTestId("drive-file-origin")).toHaveTextContent(
        `source.${kind}`,
      );
      unmount();
    }
  });

  it("says nothing when a person put the file there", () => {
    // `Upload` was on nine of ten rows in production and told the reader
    // nothing they had not just done themselves. An empty space where a badge
    // would be means a person uploaded it.
    renderRow(resource({ sourceKind: "DRIVE_UPLOAD" }));
    expect(screen.queryByTestId("drive-file-origin")).toBeNull();
  });

  it("states a confirmed project and marks a suggested one", () => {
    renderRow(
      resource({
        projects: [
          {
            id: "pl-1",
            projectId: "p-1",
            projectName: "Aurora",
            state: "CONFIRMED",
            provenance: "MANUAL",
            evidenceSnippet: null,
          },
          {
            id: "pl-2",
            projectId: "p-2",
            projectName: "Borealis",
            state: "SUGGESTED",
            provenance: "MODEL",
            evidenceSnippet: null,
          },
        ],
      }),
    );

    // A project association is the metadata whose promotion needs a person, so
    // an unconfirmed one must not read as a fact about the file.
    const provenance = screen.getByTestId("drive-file-provenance");
    expect(within(provenance).getByText("Aurora")).toBeVisible();
    expect(
      within(provenance).getByText("suggestedChip:Borealis"),
    ).toBeVisible();
  });

  it("keeps provenance out of the name line", () => {
    // Otherwise "next to the name" would drift into "everything next to the
    // name", and the labels stop being the thing the eye lands on.
    renderRow(
      resource({
        tags: [label("Finance")],
        sourceKind: "TASK_OUTPUT",
        projects: [
          {
            id: "pl-1",
            projectId: "p-1",
            projectName: "Aurora",
            state: "CONFIRMED",
            provenance: "MANUAL",
            evidenceSnippet: null,
          },
        ],
      }),
    );

    const nameRow = screen.getByTestId("drive-file-name-row");
    expect(within(nameRow).getByText("Finance")).toBeVisible();
    expect(within(nameRow).queryByText("source.TASK_OUTPUT")).toBeNull();
    expect(within(nameRow).queryByText("Aurora")).toBeNull();
  });

  it("says nothing about the parser", () => {
    /**
     * `Filename only` and `Partly indexed` are facts about what extraction
     * managed, not about the document — and they showed with no query, where no
     * retrieval had run for them to describe. Seven of ten production rows
     * carried one. The file detail page still explains it, which is where a
     * reader asking why search cannot see inside a file actually is.
     */
    for (const state of ["UNSUPPORTED", "PARTIAL", "PENDING"] as const) {
      const { unmount } = renderRow(resource({ extractionState: state }));
      const provenance = screen.getByTestId("drive-file-provenance");
      expect(provenance).not.toHaveTextContent("badge");
      expect(provenance).not.toHaveTextContent("Filename");
      unmount();
    }
  });
});

describe("opening a file", () => {
  it("opens the sheet on a plain click, without navigating", () => {
    const onOpen = vi.fn();
    render(
      <ul>
        <DriveFileRow
          item={resource()}
          viewMode="list"
          selected={false}
          onToggle={() => undefined}
          onOpen={onOpen}
        />
      </ul>,
    );

    const link = screen.getByRole("link", { name: "quarterly-report.pdf" });
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    link.dispatchEvent(event);

    expect(onOpen).toHaveBeenCalledTimes(1);
    // The default is prevented, so the reader stays on the list they are in.
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps the deep link as a real link, so a file can be shared", () => {
    render(
      <ul>
        <DriveFileRow
          item={resource()}
          viewMode="list"
          selected={false}
          onToggle={() => undefined}
          onOpen={() => undefined}
        />
      </ul>,
    );

    // An <a href> and not a button: copy-link has to work, and a screen reader
    // should announce a link to a document.
    expect(
      screen.getByRole("link", { name: "quarterly-report.pdf" }),
    ).toHaveAttribute("href", "/drive/files/res-1");
  });

  it.each([
    ["metaKey", { metaKey: true }],
    ["ctrlKey", { ctrlKey: true }],
    ["shiftKey", { shiftKey: true }],
    ["altKey", { altKey: true }],
  ])(
    "lets a %s click navigate instead of opening the sheet",
    (_name, modifier) => {
      const onOpen = vi.fn();
      render(
        <ul>
          <DriveFileRow
            item={resource()}
            viewMode="list"
            selected={false}
            onToggle={() => undefined}
            onOpen={onOpen}
          />
        </ul>,
      );

      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...modifier,
      });
      screen
        .getByRole("link", { name: "quarterly-report.pdf" })
        .dispatchEvent(event);

      // Anything the reader did to ask for a new tab is theirs to keep.
      expect(onOpen).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it("stays an ordinary link where there is no sheet to open", () => {
    // The related-files list and anything else without a sheet host.
    const onOpenAbsent = undefined;
    render(
      <ul>
        <DriveFileRow
          item={resource()}
          viewMode="list"
          selected={false}
          onToggle={() => undefined}
          onOpen={onOpenAbsent}
        />
      </ul>,
    );

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    screen
      .getByRole("link", { name: "quarterly-report.pdf" })
      .dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("what a row says", () => {
  it("has no description: no summary, no document opening, no date", () => {
    renderRow(
      resource({
        snippet: {
          text: "Copyright 2026 Acme. All rights reserved.",
          highlights: [],
          truncatedStart: false,
          truncatedEnd: true,
        },
      }),
    );

    expect(screen.queryByText(/Copyright 2026/)).toBeNull();
    expect(screen.queryByText("2 weeks ago")).toBeNull();
    expect(screen.queryByText(/PDF ·/)).toBeNull();
  });

  it("shows the matching passage only when a query matched", () => {
    renderRow(
      resource({
        snippet: {
          text: "revenue grew in the third quarter",
          highlights: [{ start: 0, end: 7 }],
          truncatedStart: false,
          truncatedEnd: false,
        },
      }),
    );

    expect(screen.getByText("revenue")).toBeVisible();
  });
});
