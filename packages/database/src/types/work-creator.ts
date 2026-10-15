const personSummarySelect = {
  select: { id: true, name: true, image: true },
} as const;

/**
 * The Creator and Requester relations a Task, Task Schedule or Job response
 * maps (ADR 0056).
 */
export const workCreatorRequesterInclude = {
  creatorUser: personSummarySelect,
  creatorCoworker: {
    select: { id: true, name: true, image: true, slug: true, vendorId: true },
  },
  creatorSokoBot: {
    select: {
      id: true,
      name: true,
      avatarSeed: true,
      avatarImageUrl: true,
      userId: true,
      user: personSummarySelect,
    },
  },
  requestedByUser: personSummarySelect,
} as const;
