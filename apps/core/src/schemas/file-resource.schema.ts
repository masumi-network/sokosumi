import { z } from "@hono/zod-openapi";
import {
  FILE_LABEL_DESCRIPTION_MAX_LENGTH,
  FILE_LABEL_NAME_MAX_GRAPHEMES,
} from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * DTOs for the intelligent Files surface.
 *
 * Two things these schemas deliberately do not have: a corpus-wide result
 * total, and any storage URL or token. A count the reader is not authorized
 * to verify would leak the existence of documents they cannot open, and
 * content is served through the authorized proxy, never by handing out a
 * blob URL.
 */

export const fileSourceKindSchema = z
  .enum([
    "DRIVE_UPLOAD",
    "TASK_OUTPUT",
    "PROJECT_DOCUMENT",
    "NATIVE_TABLE",
    "STUDIO_ASSET",
  ])
  .openapi({ description: "Canonical source this document comes from" });

export const fileExtractionStateSchema = z
  .enum([
    "PENDING",
    "RUNNING",
    "INDEXED",
    "PARTIAL",
    "UNSUPPORTED",
    "ENCRYPTED",
    "QUARANTINED",
    "FAILED",
  ])
  .openapi({
    description:
      "Processing state of the current version. PARTIAL means some text is searchable, never all of it.",
  });

export const fileLabelKindSchema = z.enum(["TAG", "CATEGORY"]);
export const fileMetadataStateSchema = z.enum([
  "SUGGESTED",
  "CONFIRMED",
  "REJECTED",
]);
export const fileMetadataProvenanceSchema = z.enum(["MANUAL", "MODEL", "RULE"]);

/**
 * These three stay unnamed on purpose. A named component that is also used
 * nullably comes back out of the generator as `Name | null`, which makes
 * every array of it an array of nullables in the web client. Inlining costs
 * a few lines of generated types and keeps `tags: FileLabel[]` honest.
 */
export const fileSnippetSchema = z
  .object({
    text: z.string(),
    highlights: z.array(
      z.object({ start: z.number().int(), end: z.number().int() }),
    ),
    truncatedStart: z.boolean(),
    truncatedEnd: z.boolean(),
  })
  .describe(
    "Extracted passage plus highlight offsets. Plain text: the client escapes at render.",
  );

export const fileLabelSchema = z.object({
  id: z.string(),
  labelId: z.string(),
  kind: fileLabelKindSchema,
  displayName: z.string(),
  state: fileMetadataStateSchema,
  provenance: fileMetadataProvenanceSchema,
  /** A short extracted span that answers "Why?". Never generated prose. */
  evidenceSnippet: z.string().nullable(),
  stale: z.boolean().openapi({
    description:
      "The suggestion was computed against an older content or vocabulary version.",
  }),
});

export const fileProjectLinkSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  state: fileMetadataStateSchema,
  provenance: fileMetadataProvenanceSchema,
  evidenceSnippet: z.string().nullable(),
});

export const fileResourceSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    mimeType: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
    sourceKind: fileSourceKindSchema,
    sourceTaskId: z.string().nullable(),
    sourceProjectId: z.string().nullable(),
    updatedAt: dateTimeSchema,
    contentRevision: z.number().int(),
    metadataRevision: z.number().int(),
    extractionState: fileExtractionStateSchema.nullable(),
    extractionCoverage: z.number().nullable(),
    extractionReason: z.string().nullable(),
    category: fileLabelSchema.nullable(),
    tags: z.array(fileLabelSchema),
    suggestions: z.array(fileLabelSchema),
    projects: z.array(fileProjectLinkSchema),
    snippet: fileSnippetSchema.nullable(),
    /**
     * Why this appeared in a related list, in the reader's own terms — a
     * confirmed project or label they can already see, never an inference.
     */
    relatedReason: z.string().nullable(),
    /** True when the normalized filename matched the query exactly. */
    filenameMatch: z.boolean(),
  })
  .openapi("FileResource");

export const fileSearchMetaSchema = z
  .object({
    rankingMode: z.enum(["deterministic", "model"]).openapi({
      description:
        "Which ordering produced this page. 'deterministic' means the model stage did not apply.",
    }),
    /**
     * Why the model stage did not apply, next to the ordering it explains.
     *
     * A closed vocabulary, deliberately. It answers "is the feature off,
     * was there anything to rank, did we run out of allowance, did we run
     * out of time, or did the provider fail" and nothing else: no provider
     * identity, no status code, no spend figures, no remaining allowance.
     */
    rankingFallback: z
      .enum([
        "disabled",
        "not-applicable",
        "capacity",
        "timeout",
        "provider-error",
      ])
      .nullable()
      .openapi({
        description:
          "Why 'deterministic' was returned. Null when the model stage applied, or when no ranking was attempted for this page.",
      }),
    resultWindowLimit: z.number().int(),
    windowCount: z.number().int().openapi({
      description:
        "Authorized entries in this bounded window, not a corpus total.",
    }),
    remainingWindowCount: z.number().int(),
    truncated: z.boolean().openapi({
      description:
        "A retrieval budget or the window cap was reached, so more may match. Independent of hasMore.",
    }),
    hasMore: z.boolean().openapi({
      description:
        "Unconsumed positions remain in this snapshot. Not a claim about the corpus.",
    }),
    nextCursor: z.string().nullable(),
    restarted: z.boolean().openapi({
      description:
        "The previous cursor no longer applied (access, query or index changed) and a fresh window was taken.",
    }),
    /**
     * The catalog this page was served from is known to be missing files.
     *
     * Adoption gives pre-existing blobs a catalog identity, and it is
     * contained on this read path so that a Blob API failure cannot 500 a
     * search that works perfectly well from Postgres without it. That
     * containment was right and is unchanged. What it did not do was say
     * anything: the branch is only reached when the pending check has
     * already answered yes, so the catalog served is *known* incomplete
     * and the reader got a bare 200.
     *
     * "Some of your files are not searchable yet" is a different sentence
     * from "no results", and only one of them is true here.
     */
    catalogIncomplete: z.boolean().openapi({
      description:
        "Adoption of pre-existing files did not finish, so this workspace's catalog is known to be missing files. Results are correct for what is catalogued.",
    }),
    indexCoverage: z
      .object({
        indexed: z.number().int(),
        processing: z.number().int(),
        filenameOnly: z.number().int(),
      })
      .openapi({
        description:
          "Coverage over this window only, so the UI can be honest about what is searchable.",
      }),
  })
  .openapi("FileSearchMeta");

export const fileSearchResponseSchema = z
  .object({
    items: z.array(fileResourceSchema),
    search: fileSearchMetaSchema,
  })
  .openapi("FileSearchResponse");

export const fileRelatedResponseSchema = z
  .object({
    items: z.array(fileResourceSchema),
    state: z.enum(["ok", "empty", "not-indexed", "unavailable"]).openapi({
      description:
        "'not-indexed' means processing has not finished; 'unavailable' means ranking failed and the reader may retry.",
    }),
  })
  .openapi("FileRelatedResponse");

export const workspaceLabelSchema = z
  .object({
    id: z.string(),
    kind: fileLabelKindSchema,
    displayName: z.string(),
    description: z.string().nullable(),
    archived: z.boolean(),
    vocabularyVersion: z.number().int(),
  })
  .openapi("WorkspaceLabel");

export const createWorkspaceLabelRequestSchema = z.object({
  kind: fileLabelKindSchema,
  displayName: z
    .string()
    .min(1)
    .max(FILE_LABEL_NAME_MAX_GRAPHEMES * 4),
  description: z.string().max(FILE_LABEL_DESCRIPTION_MAX_LENGTH).nullish(),
});

export const updateWorkspaceLabelRequestSchema = z.object({
  displayName: z
    .string()
    .min(1)
    .max(FILE_LABEL_NAME_MAX_GRAPHEMES * 4)
    .optional(),
  description: z.string().max(FILE_LABEL_DESCRIPTION_MAX_LENGTH).nullish(),
  archived: z.boolean().optional(),
  /** Merge this label into another; old assignments redirect. */
  mergeIntoLabelId: z.string().optional(),
});

export const updateFileMetadataRequestSchema = z
  .object({
    expectedMetadataRevision: z.number().int().openapi({
      description:
        "Reject the edit if someone else changed this document's metadata first.",
    }),
    addTagLabelIds: z.array(z.string()).max(20).optional(),
    removeTagLabelIds: z.array(z.string()).max(20).optional(),
    /** null clears the category and re-opens it to suggestions. */
    categoryLabelId: z.string().nullish(),
    confirmProjectIds: z.array(z.string()).max(20).optional(),
    removeProjectIds: z.array(z.string()).max(20).optional(),
    /** Re-open a pinned field so suggestions may apply again. */
    allowSuggestionsFor: z.array(z.enum(["category", "tags"])).optional(),
  })
  .openapi("UpdateFileMetadataRequest");

export const fileMetadataBatchRequestSchema = z
  .object({
    resourceIds: z.array(z.string()).max(100).optional(),
    selectionToken: z.string().optional(),
    idempotencyKey: z.string().min(8).max(200),
    addTagLabelIds: z.array(z.string()).max(20).optional(),
    removeTagLabelIds: z.array(z.string()).max(20).optional(),
    categoryLabelId: z.string().nullish(),
    expectedRevisions: z
      .array(
        z.object({
          resourceId: z.string(),
          metadataRevision: z.number().int(),
        }),
      )
      .max(120)
      .optional(),
  })
  .openapi("FileMetadataBatchRequest");

export const fileMetadataBatchResponseSchema = z
  .object({
    outcomes: z.array(
      z.object({
        resourceId: z.string(),
        status: z.enum(["applied", "conflict", "forbidden", "not-found"]),
        metadataRevision: z.number().int().nullable(),
      }),
    ),
    /** Entries the caller must reconfirm because the window moved. */
    revisedCount: z.number().int().nullable(),
  })
  .openapi("FileMetadataBatchResponse");

export const fileSuggestionDecisionRequestSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    expectedMetadataRevision: z.number().int(),
  })
  .openapi("FileSuggestionDecisionRequest");

export const fileCollectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    definition: z.record(z.string(), z.unknown()),
    sortBy: z.string().nullable(),
    sortOrder: z.string().nullable(),
    isShared: z.boolean(),
    definitionVersion: z.number().int(),
    isOwner: z.boolean(),
  })
  .openapi("FileCollection");

export const createFileCollectionRequestSchema = z.object({
  name: z.string().min(1).max(120),
  definition: z.record(z.string(), z.unknown()),
  sortBy: z.string().max(40).nullish(),
  sortOrder: z.enum(["asc", "desc"]).nullish(),
  isShared: z.boolean().optional(),
});

export const updateFileCollectionRequestSchema =
  createFileCollectionRequestSchema.partial();

export const fileSelectionTokenResponseSchema = z
  .object({
    token: z.string(),
    count: z.number().int().openapi({
      description:
        "Entries in this bounded window that are still eligible, never a corpus total.",
    }),
    expiresAt: dateTimeSchema,
  })
  .openapi("FileSelectionTokenResponse");

export type FileResourceDto = z.infer<typeof fileResourceSchema>;
export type FileSearchMetaDto = z.infer<typeof fileSearchMetaSchema>;
