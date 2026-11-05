const personSummarySelect = {
  select: { id: true, name: true, image: true },
} as const;

/** The Creator relations a Task, Task Schedule or Job response maps. */
export const workCreatorInclude = {
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
      avatar: { select: { styleId: true } },
      userId: true,
      user: personSummarySelect,
    },
  },
} as const;
