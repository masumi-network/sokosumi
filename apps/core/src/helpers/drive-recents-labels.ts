import {
  FileLabelKind,
  FileMetadataState,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

/**
 * Catalog identity and labels for Drive uploads in Recents.
 *
 * Recents lists the blob store, which knows nothing about labels; the catalog
 * holds them against the same pathname. A file the catalog has not adopted
 * yet has no resource and no labels, which is what it shows.
 */

export interface DriveRecentsLabel {
  labelId: string;
  displayName: string;
}

export interface DriveRecentsCatalogEntry {
  resourceId: string;
  category: DriveRecentsLabel | null;
  tags: DriveRecentsLabel[];
}

interface DriveStoreRef {
  workspaceId: string;
  scope: "user" | "organization";
}

function sourceScopeOf(scope: DriveStoreRef["scope"]): FileSourceScope {
  return scope === "user" ? FileSourceScope.USER : FileSourceScope.ORGANIZATION;
}

/** A person's removal is final for display: rejected labels never show. */
const SHOWN_STATES = [FileMetadataState.CONFIRMED, FileMetadataState.SUGGESTED];

export async function findDriveRecentsCatalogEntries(
  input: DriveStoreRef & { pathnames: string[] },
): Promise<Map<string, DriveRecentsCatalogEntry>> {
  if (input.pathnames.length === 0) return new Map();

  const resources = await prisma.fileResource.findMany({
    where: {
      workspaceId: input.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: sourceScopeOf(input.scope),
      sourceId: { in: input.pathnames },
      tombstonedAt: null,
    },
    select: {
      id: true,
      sourceId: true,
      labels: {
        where: { state: { in: SHOWN_STATES } },
        select: {
          state: true,
          label: { select: { id: true, kind: true, displayName: true } },
        },
      },
    },
  });

  return new Map(
    resources.map((resource) => {
      // Confirmed first, so a category a person agreed with wins the slot.
      const labels = [...resource.labels].sort((left, right) =>
        left.state === right.state
          ? left.label.displayName.localeCompare(right.label.displayName)
          : left.state === FileMetadataState.CONFIRMED
            ? -1
            : 1,
      );
      const toLabel = (entry: (typeof labels)[number]): DriveRecentsLabel => ({
        labelId: entry.label.id,
        displayName: entry.label.displayName,
      });
      const category = labels.find(
        (entry) => entry.label.kind === FileLabelKind.CATEGORY,
      );
      return [
        resource.sourceId,
        {
          resourceId: resource.id,
          category: category ? toLabel(category) : null,
          tags: labels
            .filter((entry) => entry.label.kind === FileLabelKind.TAG)
            .map(toLabel),
        },
      ];
    }),
  );
}

/**
 * Pathnames in this store carrying any of these labels. Recents filters its
 * blob listing by this set, so a tag filter only ever narrows what the reader
 * could already see.
 */
export async function findDriveUploadPathnamesWithLabels(
  input: DriveStoreRef & { labelIds: string[] },
): Promise<Set<string>> {
  const resources = await prisma.fileResource.findMany({
    where: {
      workspaceId: input.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: sourceScopeOf(input.scope),
      tombstonedAt: null,
      labels: {
        some: {
          labelId: { in: input.labelIds },
          state: { in: SHOWN_STATES },
        },
      },
    },
    select: { sourceId: true },
  });
  return new Set(resources.map((resource) => resource.sourceId));
}
