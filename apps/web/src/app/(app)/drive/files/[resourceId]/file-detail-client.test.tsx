import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The detail screen resolves its scope from the session, and the session
 * arrives after the first render. That made two loads race.
 *
 * Observed on preprod: opening a file directly showed "File unavailable" for
 * an organization file that the very same page rendered fine when reached by
 * clicking through. The personal-scope request issued before the session
 * landed 404s quickly, and its reply was overwriting the organization
 * reply's.
 */

const {
  useSessionMock,
  fetchFileResourceMock,
  fetchRelatedFilesMock,
  fetchWorkspaceLabelsMock,
  updateFileMetadataMock,
} = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  fetchFileResourceMock: vi.fn(),
  fetchRelatedFilesMock: vi.fn(),
  fetchWorkspaceLabelsMock: vi.fn(),
  updateFileMetadataMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({ useSession: useSessionMock }));
vi.mock("@/lib/utils/file-search.client", () => ({
  fetchFileResource: fetchFileResourceMock,
  fetchRelatedFiles: fetchRelatedFilesMock,
  fetchWorkspaceLabels: fetchWorkspaceLabelsMock,
  decideSuggestion: vi.fn(),
  updateFileMetadata: updateFileMetadataMock,
}));
vi.mock("@/app/drive/components/drive-file-preview", () => ({
  DriveFilePreview: () => <div data-testid="file-preview" />,
}));
vi.mock("@/app/drive/components/drive-file-snippet", () => ({
  DriveFileSnippet: () => null,
}));
vi.mock("next-intl", () => ({
  // Values are echoed, not dropped. A stub that returned the key alone
  // made every interpolated string look identical, so a message whose
  // whole purpose is the number it carries could not be asserted on.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { FileDetailClient } from "./file-detail-client";

const resource = {
  id: "resource-1",
  displayName: "quarterly.md",
  mimeType: null,
  sizeBytes: 1024,
  sourceKind: "UPLOAD",
  extractionState: "INDEXED",
  extractionReason: null,
  extractionCoverage: null,
  category: null,
  tags: [],
  suggestions: [],
  projects: [],
  metadataRevision: 1,
};

function signedInWithOrg() {
  useSessionMock.mockReturnValue({
    data: { session: { activeOrganizationId: "org-7" } },
    isPending: false,
  });
}

describe("FileDetailClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchRelatedFilesMock.mockResolvedValue({ items: [], state: "ok" });
  });

  it("waits for the session before asking for the file", () => {
    useSessionMock.mockReturnValue({ data: undefined, isPending: true });
    fetchFileResourceMock.mockResolvedValue(resource);

    render(<FileDetailClient resourceId="resource-1" />);

    // Asking now would ask the personal drive for an organization file.
    expect(fetchFileResourceMock).not.toHaveBeenCalled();
  });

  it("asks with the organization scope once the session resolves", async () => {
    signedInWithOrg();
    fetchFileResourceMock.mockResolvedValue(resource);

    render(<FileDetailClient resourceId="resource-1" />);

    await waitFor(() => expect(fetchFileResourceMock).toHaveBeenCalled());
    expect(fetchFileResourceMock.mock.calls[0][0].store).toEqual({
      scope: "org",
      organizationId: "org-7",
    });
  });

  it("renders the document once it loads", async () => {
    signedInWithOrg();
    fetchFileResourceMock.mockResolvedValue(resource);

    render(<FileDetailClient resourceId="resource-1" />);

    expect(await screen.findByTestId("file-detail")).toBeInTheDocument();
    expect(screen.getByTestId("file-preview")).toBeInTheDocument();
  });

  it("is not defeated by a stale rejection landing last", async () => {
    // The real sequence, on one mounted component: the personal-scope
    // request goes out first, the session resolves to an organization, the
    // organization request succeeds — and only then does the superseded
    // personal one reject. Before the guard, that last rejection painted
    // "File unavailable" over a document already on screen.
    useSessionMock.mockReturnValue({
      data: { session: { activeOrganizationId: null } },
      isPending: false,
    });

    let rejectStale: (reason: Error) => void = () => {};
    const stale = new Promise<never>((_, reject) => {
      rejectStale = reject;
    });
    fetchFileResourceMock
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce(resource);

    const { rerender } = render(<FileDetailClient resourceId="resource-1" />);
    await waitFor(() => expect(fetchFileResourceMock).toHaveBeenCalledTimes(1));
    expect(fetchFileResourceMock.mock.calls[0][0].store).toEqual({
      scope: "me",
    });

    // Same component, new scope: the session has resolved.
    signedInWithOrg();
    rerender(<FileDetailClient resourceId="resource-1" />);

    await waitFor(() => expect(fetchFileResourceMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("file-detail")).toBeInTheDocument();

    rejectStale(new Error("404"));
    await Promise.resolve();

    await waitFor(() =>
      expect(screen.getByTestId("file-detail")).toBeInTheDocument(),
    );
    expect(screen.queryByText("unavailableTitle")).not.toBeInTheDocument();
  });

  /**
   * The one-way door, closed.
   *
   * Removing a tag writes a durable rejection, so the model will not
   * suggest it again — which is right. The problem was that nothing in
   * the web app ever passed `addTagLabelIds`, and the endpoint has
   * handled it all along. No undo, no control here, nothing in the row
   * menu, no tag setter in the bulk bar, and reindex deliberately
   * declines. So an accepted tag, once removed, was gone for good.
   *
   * These assert the wiring, not the persistence: the backend half is
   * `tag-removal-one-way-door.postgres.test.ts`.
   */
  describe("putting a removed tag back", () => {
    const tagged = {
      ...resource,
      metadataRevision: 4,
      tags: [
        { id: "fl-1", labelId: "label-commuting", displayName: "Commuting" },
      ],
    };

    beforeEach(() => {
      signedInWithOrg();
      fetchFileResourceMock.mockResolvedValue(tagged);
      fetchWorkspaceLabelsMock.mockResolvedValue([
        {
          id: "label-commuting",
          kind: "TAG",
          displayName: "Commuting",
          description: null,
          archived: false,
          vocabularyVersion: 1,
        },
        {
          id: "label-cycling",
          kind: "TAG",
          displayName: "Cycling",
          description: null,
          archived: false,
          vocabularyVersion: 1,
        },
      ]);
    });

    it("offers an add control on a file that has tags", async () => {
      render(<FileDetailClient resourceId="resource-1" />);

      expect(await screen.findByTestId("add-tag")).toBeInTheDocument();
    });

    it("asks only for tags, in the file's own scope", async () => {
      render(<FileDetailClient resourceId="resource-1" />);
      await userEvent.click(await screen.findByTestId("add-tag"));

      await waitFor(() => expect(fetchWorkspaceLabelsMock).toHaveBeenCalled());
      // A category offered in a tag picker would be refused by the edit as
      // the wrong kind, and an organization file must not be asked about
      // against the personal drive.
      expect(fetchWorkspaceLabelsMock.mock.calls[0][0]).toEqual({
        store: { scope: "org", organizationId: "org-7" },
        kind: "TAG",
      });
    });

    it("adds the picked tag against the revision it is holding", async () => {
      updateFileMetadataMock.mockResolvedValue({
        ...tagged,
        metadataRevision: 5,
      });

      render(<FileDetailClient resourceId="resource-1" />);
      await userEvent.click(await screen.findByTestId("add-tag"));
      await userEvent.click(await screen.findByText("Cycling"));

      await waitFor(() => expect(updateFileMetadataMock).toHaveBeenCalled());
      expect(updateFileMetadataMock.mock.calls[0][0]).toEqual({
        store: { scope: "org", organizationId: "org-7" },
        resourceId: "resource-1",
        expectedMetadataRevision: 4,
        addTagLabelIds: ["label-cycling"],
      });
    });

    it("does not offer a tag the file already carries", async () => {
      render(<FileDetailClient resourceId="resource-1" />);
      await userEvent.click(await screen.findByTestId("add-tag"));

      await waitFor(() => expect(fetchWorkspaceLabelsMock).toHaveBeenCalled());
      // "Commuting" is on the file, so it appears as a badge and must not
      // also appear as something to add: picking it would be a no-op the
      // person cannot tell apart from a failure.
      expect(await screen.findByText("Cycling")).toBeInTheDocument();
      expect(screen.getAllByText("Commuting")).toHaveLength(1);
    });

    it("reloads rather than lying when the revision is stale", async () => {
      updateFileMetadataMock.mockRejectedValue(new Error("409"));

      render(<FileDetailClient resourceId="resource-1" />);
      await userEvent.click(await screen.findByTestId("add-tag"));
      await userEvent.click(await screen.findByText("Cycling"));

      // Same branch as removeTag: the page's revision is from whenever it
      // last loaded, so a conflict means showing the current state.
      await waitFor(() =>
        expect(fetchFileResourceMock.mock.calls.length).toBeGreaterThan(1),
      );
    });
  });
  /**
   * How much of the file was read, not just that some of it was.
   *
   * The panel rendered "Only part of this file is indexed." and nothing
   * else, which reads identically at 50% and at 99%. On a 400-slide deck
   * extracted at coverage 0.5 that is half the deck missing, with nothing
   * on the page to say so — and making the missing slides visible to the
   * person who uploaded the file is the entire point of recording
   * coverage in the first place. Core stores it; the web layer was
   * dropping it.
   *
   * Deliberately not `extractionReason`, which the UNSUPPORTED arm
   * renders. That string is composed in core in English, so it puts an
   * English sentence on a German page. A percentage localises by itself.
   */
  describe("how much of a partial file was read", () => {
    function partial(extractionCoverage: number | null) {
      signedInWithOrg();
      fetchFileResourceMock.mockResolvedValue({
        ...resource,
        extractionState: "PARTIAL",
        extractionCoverage,
      });
      render(<FileDetailClient resourceId="resource-1" />);
    }

    it("says the share that was read", async () => {
      partial(0.5);

      expect(
        await screen.findByText('processingPartialCoverage:{"percent":50}'),
        "the reader cannot tell half a deck from nearly all of it",
      ).toBeInTheDocument();
    });

    it("falls back to the plain sentence when nothing was recorded", async () => {
      // Coverage is nullable, and a number invented for a null is worse
      // than no number.
      partial(null);

      expect(await screen.findByText("processingPartial")).toBeInTheDocument();
    });

    it("never says about 100% under 'only part of this file'", async () => {
      /**
       * PARTIAL is set by `truncated || chunkCapped || source.truncated ||
       * wholeDocumentCoverage < 0.999`, so a document really can be
       * PARTIAL at 0.9995. Rounding that to 100 puts a sentence directly
       * under "only part of this file is indexed" that contradicts it.
       *
       * This is the case that fails if the clamp is ever removed.
       */
      partial(0.9995);

      expect(
        await screen.findByText('processingPartialCoverage:{"percent":99}'),
        "the state says part and the number says all",
      ).toBeInTheDocument();
    });

    it("never says about 100% when coverage rounds up to the whole file", async () => {
      /**
       * The case that actually exercises the upper clamp, and it is not
       * the one above.
       *
       * Flooring already takes 0.9995 to 99 on its own, so that case
       * would stay green with `Math.min(99, …)` deleted. What needs the
       * clamp is coverage of exactly 1 in the PARTIAL state, which is
       * reachable: the state is set by `truncated || chunkCapped ||
       * source.truncated || wholeDocumentCoverage < 0.999`, and the first
       * three can be true while the coverage figure is a whole 1.
       *
       * Both cases are kept. The one above pins the floor, this one pins
       * the ceiling, and neither stands in for the other.
       */
      partial(1);

      expect(
        await screen.findByText('processingPartialCoverage:{"percent":99}'),
        "a truncated document reported its coverage as the whole file, so " +
          "the panel said about 100% directly under 'only part of this " +
          "file is indexed'",
      ).toBeInTheDocument();
    });

    it("never says about 0% for a file something was read from", async () => {
      // The other end of the clamp. PARTIAL means something was read, so
      // 0 would be false — and a reader seeing 0% would reasonably
      // conclude nothing is searchable, which is a worse claim than "a
      // little is".
      partial(0.0004);

      expect(
        await screen.findByText('processingPartialCoverage:{"percent":1}'),
      ).toBeInTheDocument();
    });

    it("does not show coverage for a fully indexed file", async () => {
      // The number belongs to the partial state and nowhere else.
      signedInWithOrg();
      fetchFileResourceMock.mockResolvedValue({
        ...resource,
        extractionState: "INDEXED",
        extractionCoverage: 1,
      });
      render(<FileDetailClient resourceId="resource-1" />);

      expect(await screen.findByText("processingIndexed")).toBeInTheDocument();
    });
  });
});
