import { InputJsonValue } from "@prisma/client/runtime/client";

import prisma from "../client";
import type { Agent, Category, Prisma } from "../generated/prisma/client";

export const categoryRepository = {
  getCategories: async (
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category[]> => {
    return tx.category.findMany({
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
  },

  getCategoriesWithAgents: async (
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category[]> => {
    return tx.category.findMany({
      where: {
        agents: { some: { status: "ONLINE", isShown: true } },
      },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
  },

  getBySlug: async (
    slug: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category | null> => {
    return tx.category.findUnique({
      where: { slug },
    });
  },

  getDefaultCategory: async (
    defaultSlug: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category | null> => {
    const category = await tx.category.findUnique({
      where: { slug: defaultSlug },
    });

    return category;
  },

  create: async (
    data: Pick<Category, "name" | "slug"> &
      Partial<Pick<Category, "description" | "image" | "styles" | "priority">>,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category> => {
    return tx.category.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        image: data.image,
        styles: data.styles as InputJsonValue,
        priority: data.priority ?? 0,
      },
    });
  },

  setAgentCategories: async (
    agentId: string,
    categoryIds: string[],
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Agent> => {
    return tx.agent.update({
      where: { id: agentId },
      data: {
        categories: {
          set: categoryIds.map((id) => ({ id })),
        },
      },
    });
  },
};
