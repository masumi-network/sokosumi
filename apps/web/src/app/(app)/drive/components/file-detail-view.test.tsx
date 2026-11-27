import type { FileResource, FileSearchMeta } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchFileResource: vi.fn(),
  fetchRelatedFiles: vi.fn(),
  updateFileMetadata: vi.fn(),
  decideSuggestion: vi.fn(),
  fetchFileSearchPage: vi.fn(),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("@/lib/utils/file-search.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/file-search.client")>()),
  ...api,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org_a" } },
    isPending: false,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/app/drive/components/drive-file-preview", () => ({
  DriveFilePreview: () => <div data-testid="file-preview-stub" />,
}));

import {
  EMPTY_FILE_FILTERS,
  type FileStore,
  fetchFileSearchPage,
} from "@/lib/utils/file-search.client";
import { driveQueryKeys, splitDriveQueryKey } from "@/queries/drive";
import { useScopedInfiniteQuery } from "@/queries/scoped-queries";
import { FileDetailView } from "./file-detail-view";

const orgA: FileStore = { scope: "org", organizationId: "org_a" };

function makeMeta(): FileSearchMeta {
  return {
    rankingMode: "deterministic",
    rankingFallback: null,
    resultWindowLimit: 120,
    windowCount: 1,
    remainingWindowCount: 0,
    truncated: false,
    hasMore: false,
    nextCursor: null,
    windowCursor: "window-1",
    restarted: false,
    catalogIncomplete: false,
    indexCoverage: { indexed: 1, processing: 0, filenameOnly: 0 },
  };
}

function makeLabelAssignment(
  id: string,
  labelId: string,
  displayName: string,
  state: "CONFIRMED" | "REJECTED" | "SUGGESTED",
): FileResource["tags"][number] {
  return {
    id,
    labelId,
    kind: "TAG",
    displayName,
    state,
    provenance: state === "SUGGESTED" ? "MODEL" : "MANUAL",
    evidenceSnippet: state === "SUGGESTED" ? "Q4 board summary" : null,
    stale: false,
  };
}

function makeResource(overrides: Partial<FileResource> = {}): FileResource {
  return {
    id: "res-1",
    displayName: "quarterly-report.pdf",
    pathname: "drive/orgs/org_a/quarterly-report.pdf",
    sourceKind: "DRIVE_UPLOAD",
    mimeType: "application/pdf",
    sizeBytes: 4096,
    metadataRevision: 1,
    extractionState: "INDEXED",
    extractionCoverage: 1,
    extractionReason: null,
    category: null,
    tags: [
      makeLabelAssignment("tag-row-1", "lbl-finance", "Finance", "CONFIRMED"),
    ],
    rejected: [],
    suggestions: [
      makeLabelAssignment("sug-1", "lbl-board", "Board Deck", "SUGGESTED"),
    ],
    projects: [],
    ...overrides,
  } as unknown as FileResource;
}

/** Mounted catalog subscriber sharing the same Drive query cache as FileDetailView. */
function CatalogRowProbe({ store }: { store: FileStore }) {
  const { scope, queryKey } = splitDriveQueryKey(
    driveQueryKeys.catalog(store, {
      query: "",
      filters: EMPTY_FILE_FILTERS,
      directOnly: true,
      sortBy: "modified",
      sortOrder: "desc",
    }),
  );

  const query = useScopedInfiniteQuery({
    scope,
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      fetchFileSearchPage({
        store,
        query: "",
        filters: EMPTY_FILE_FILTERS,
        sortBy: "modified",
        sortOrder: "desc",
        cursor: pageParam,
        directOnly: true,
        signal,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.search.hasMore
        ? (lastPage.search.nextCursor ?? undefined)
        : undefined,
  });

  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div data-testid="catalog-probe">
      {rows.map((row) => (
        <div key={row.id} data-testid={`catalog-row-${row.id}`}>
          <span>{row.displayName}</span>
          {row.tags.map((tag) => (
            <span key={tag.id}>{tag.displayName}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

describe("FileDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates the Drive cache when removing a tag so the catalog row drops the tag", async () => {
    const initial = makeResource();
    const withoutTag = makeResource({
      metadataRevision: 2,
      tags: [],
      rejected: [
        makeLabelAssignment("rej-1", "lbl-finance", "Finance", "REJECTED"),
      ],
    });

    api.fetchFileResource.mockResolvedValue(initial);
    api.fetchRelatedFiles.mockResolvedValue({ items: [], state: "ok" });
    api.fetchFileSearchPage
      .mockResolvedValueOnce({ items: [initial], search: makeMeta() })
      .mockResolvedValueOnce({ items: [withoutTag], search: makeMeta() });
    api.updateFileMetadata.mockResolvedValue(withoutTag);

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
        mutations: { gcTime: Number.POSITIVE_INFINITY },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <CatalogRowProbe store={orgA} />
        <FileDetailView resourceId="res-1" />
      </QueryClientProvider>,
    );

    const catalogRow = await screen.findByTestId("catalog-row-res-1");
    expect(within(catalogRow).getByText("Finance")).toBeInTheDocument();

    const removeButton = await screen.findByRole("button", {
      name: 'removeTag:{"name":"Finance"}',
    });
    await userEvent.click(removeButton);

    await waitFor(() =>
      expect(api.updateFileMetadata).toHaveBeenCalledWith({
        store: orgA,
        resourceId: "res-1",
        expectedMetadataRevision: 1,
        removeTagLabelIds: ["lbl-finance"],
      }),
    );

    await waitFor(() =>
      expect(within(catalogRow).queryByText("Finance")).not.toBeInTheDocument(),
    );
    expect(api.fetchFileSearchPage).toHaveBeenCalledTimes(2);
  });

  it("invalidates the Drive cache when accepting a suggestion or reopening a rejected label", async () => {
    const initial = makeResource({
      tags: [],
      rejected: [
        makeLabelAssignment("rej-1", "lbl-finance", "Finance", "REJECTED"),
      ],
    });
    const afterAccept = makeResource({
      metadataRevision: 2,
      tags: [
        makeLabelAssignment(
          "tag-row-2",
          "lbl-board",
          "Board Deck",
          "CONFIRMED",
        ),
      ],
      rejected: [
        makeLabelAssignment("rej-1", "lbl-finance", "Finance", "REJECTED"),
      ],
      suggestions: [],
    });
    const afterReopen = makeResource({
      metadataRevision: 3,
      tags: [
        makeLabelAssignment(
          "tag-row-2",
          "lbl-board",
          "Board Deck",
          "CONFIRMED",
        ),
      ],
      rejected: [],
      suggestions: [],
    });

    api.fetchFileResource.mockResolvedValue(initial);
    api.fetchRelatedFiles.mockResolvedValue({ items: [], state: "ok" });
    api.fetchFileSearchPage
      .mockResolvedValueOnce({ items: [initial], search: makeMeta() })
      .mockResolvedValueOnce({ items: [afterAccept], search: makeMeta() })
      .mockResolvedValueOnce({ items: [afterReopen], search: makeMeta() });
    api.decideSuggestion.mockResolvedValue(afterAccept);
    api.updateFileMetadata.mockResolvedValue(afterReopen);

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
        mutations: { gcTime: Number.POSITIVE_INFINITY },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <CatalogRowProbe store={orgA} />
        <FileDetailView resourceId="res-1" />
      </QueryClientProvider>,
    );

    const catalogRow = await screen.findByTestId("catalog-row-res-1");
    expect(
      within(catalogRow).queryByText("Board Deck"),
    ).not.toBeInTheDocument();

    await userEvent.click(
      await screen.findByRole("button", { name: "suggestionAccept" }),
    );

    await waitFor(() =>
      expect(within(catalogRow).getByText("Board Deck")).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByTestId("file-detail-allow-again"));

    await waitFor(() =>
      expect(api.fetchFileSearchPage).toHaveBeenCalledTimes(3),
    );
  });
});
