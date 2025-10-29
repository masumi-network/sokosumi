import "server-only";

import { Agent, Category, Prisma } from "@/prisma/generated/client";
import { InputJsonValue } from "@/prisma/generated/client/runtime/library";

import prisma from "./prisma";

export const categoryRepository = {
  getCategories: async (
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category[]> => {
    return tx.category.findMany({
      orderBy: { name: "asc" },
    });
  },

  getCategoriesWithAgents: async (
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category[]> => {
    return tx.category.findMany({
      where: {
        agents: { some: {} },
      },
      orderBy: { name: "asc" },
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

  create: async (
    data: Pick<Category, "name" | "slug"> &
      Partial<Pick<Category, "description" | "image" | "styles">>,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category> => {
    return tx.category.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        image: data.image,
        styles: data.styles as InputJsonValue,
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

