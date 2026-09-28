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
  useTranslations: () => (key: string) => key,
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
});
