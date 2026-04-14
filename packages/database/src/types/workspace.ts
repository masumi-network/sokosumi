export const workspaceRelationInclude = {
  workspace: {
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },
} as const;
