import { InputJsonValue } from "@prisma/client/runtime/client";

import prisma from "../client.js";
import type { Category, Prisma } from "../generated/prisma/client.js";

export const categoryRepository = {
  getCategories: async (
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category[]> => {
    return tx.category.findMany({
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
  },

  getCategoriesForAvailableAgents: async (
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

  create: async (
    data: Pick<Category, "name" | "slug" | "priority"> &
      Partial<Pick<Category, "description" | "image" | "styles">>,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Category> => {
    return tx.category.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        image: data.image,
        styles: data.styles,
        priority: data.priority,
      },
    });
  },
};
