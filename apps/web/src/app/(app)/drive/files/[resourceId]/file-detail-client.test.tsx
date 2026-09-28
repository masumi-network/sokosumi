import { render, screen, waitFor, within } from "@testing-library/react";
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
  rejected: [],
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
  describe("withdrawing a veto on a label", () => {
    /**
     * The manual tag picker used to live here, and removing it closed the only
     * path in the product that could clear a rejection — so a wrong Remove would
     * have become permanent. These replace those cases: the veto is still
     * possible, and it is still undoable, without anyone asserting a label.
     */
    it("shows a removed label, so the veto can be seen at all", async () => {
      signedInWithOrg();
      fetchFileResourceMock.mockResolvedValue({
        ...resource,
        rejected: [
          {
            id: "fl-1",
            labelId: "wl-1",
            kind: "TAG",
            displayName: "Finance",
            state: "REJECTED",
            provenance: "MANUAL",
            evidenceSnippet: null,
            stale: false,
          },
        ],
      });

      render(<FileDetailClient resourceId="resource-1" />);

      // Rejected labels were filtered out of every response, so a removed label
      // simply vanished and the tombstone barring it was unreachable.
      const rejected = await waitFor(() =>
        screen.getByTestId("file-detail-rejected"),
      );
      expect(within(rejected).getByText("Finance")).toBeVisible();
    });

    it("withdraws the veto without re-applying the label", async () => {
      signedInWithOrg();
      fetchFileResourceMock.mockResolvedValue({
        ...resource,
        rejected: [
          {
            id: "fl-1",
            labelId: "wl-1",
            kind: "TAG",
            displayName: "Finance",
            state: "REJECTED",
            provenance: "MANUAL",
            evidenceSnippet: null,
            stale: false,
          },
        ],
      });
      updateFileMetadataMock.mockResolvedValue({ ...resource, rejected: [] });

      render(<FileDetailClient resourceId="resource-1" />);

      const button = await waitFor(() =>
        screen.getByTestId("file-detail-allow-again"),
      );
      button.click();

      await waitFor(() => {
        expect(updateFileMetadataMock).toHaveBeenCalled();
      });
      const call = updateFileMetadataMock.mock.calls.at(-1)?.[0];
      // Re-opens the question and answers nothing: no label is added, no state
      // is set. A person vetoes or withdraws a veto; the model decides.
      expect(call).toMatchObject({
        resourceId: "resource-1",
        expectedMetadataRevision: 1,
        allowSuggestionsForLabelIds: ["wl-1"],
      });
      expect(call).not.toHaveProperty("addTagLabelIds");
    });

    it("offers no way to add a label by hand", async () => {
      signedInWithOrg();
      fetchFileResourceMock.mockResolvedValue({
        ...resource,
        rejected: [],
        tags: [
          {
            id: "fl-2",
            labelId: "wl-2",
            kind: "TAG",
            displayName: "Legal",
            state: "CONFIRMED",
            provenance: "MODEL",
            evidenceSnippet: null,
            stale: false,
          },
        ],
      });

      render(<FileDetailClient resourceId="resource-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("file-detail")).toBeVisible();
      });
      // Tagging is the system's job. The vocabulary is curated product data and
      // the model picks from it; a person's only inputs are a veto and its
      // withdrawal.
      expect(screen.queryByTestId("add-tag")).toBeNull();
      // The veto itself stays.
      expect(screen.getByRole("button", { name: /Legal/ })).toBeInTheDocument();
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
       * This case characterises the near-full end; it does not guard the
       * clamp. Measured, not assumed: with `Math.min(99, ...)` deleted it
       * stays green, because `Math.floor(99.95)` is already 99. The
       * ceiling is guarded by the coverage-of-exactly-1 case below, and
       * the flooring by the case after that.
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

    it("floors rather than rounds, so it never claims more than was read", async () => {
      /**
       * The code says "floored rather than rounded, so the number never
       * promises more than was actually read". Nothing tested that, and
       * the near-full case above does not: at 0.9995 floor and round both
       * land on 99 once the clamp has had its say.
       *
       * 0.509 separates them. Floor gives 50, round gives 51, and 51 is a
       * number the file did not earn.
       */
      partial(0.509);

      expect(
        await screen.findByText('processingPartialCoverage:{"percent":50}'),
        "rounding up reports a share of the document that was never read",
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
