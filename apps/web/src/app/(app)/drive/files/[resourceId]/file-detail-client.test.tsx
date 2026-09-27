import { render, screen, waitFor } from "@testing-library/react";
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

const { useSessionMock, fetchFileResourceMock, fetchRelatedFilesMock } =
  vi.hoisted(() => ({
    useSessionMock: vi.fn(),
    fetchFileResourceMock: vi.fn(),
    fetchRelatedFilesMock: vi.fn(),
  }));

vi.mock("@/lib/auth/auth.client", () => ({ useSession: useSessionMock }));
vi.mock("@/lib/utils/file-search.client", () => ({
  fetchFileResource: fetchFileResourceMock,
  fetchRelatedFiles: fetchRelatedFilesMock,
  decideSuggestion: vi.fn(),
  updateFileMetadata: vi.fn(),
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
});
