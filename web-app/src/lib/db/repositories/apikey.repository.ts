import prisma from "@/lib/db/repositories/prisma";
import { Apikey, Prisma } from "@/prisma/generated/client";

/**
 * Repository for API key-related database operations.
 * Provides methods to retrieve, create, update, and delete API key records using Prisma.
 */
export const apikeyRepository = {
  /**
   * Retrieves all API keys for a specific user.
   *
   * @param userId - The unique identifier of the user.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to an array of API key objects.
   */
  getUserApiKeys: async (
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Apikey[]> => {
    return tx.apikey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Retrieves an API key by its unique ID.
   *
   * @param id - The unique identifier of the API key.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the API key object if found, or null otherwise.
   */
  getApiKeyById: async (
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Apikey | null> => {
    return tx.apikey.findUnique({ where: { id } });
  },

  /**
   * Retrieves an API key by its unique ID and user ID for authorization.
   *
   * @param id - The unique identifier of the API key.
   * @param userId - The unique identifier of the user who owns the API key.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the API key object if found, or null otherwise.
   */
  getUserApiKeyById: async (
    id: string,
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Apikey | null> => {
    return tx.apikey.findUnique({
      where: { id, userId },
    });
  },

  /**
   * Creates a new API key for a user.
   *
   * @param data - The API key data to create.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the created API key object.
   */
  createApiKeyById: async (
    data: Prisma.ApikeyCreateInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Apikey> => {
    return tx.apikey.create({
      data,
    });
  },

  /**
   * Updates an existing API key.
   *
   * @param id - The unique identifier of the API key to update.
   * @param data - The data to update the API key with.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the updated API key object.
   */
  updateApiKey: async (
    id: string,
    data: Prisma.ApikeyUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Apikey> => {
    return tx.apikey.update({
      where: { id },
      data,
    });
  },

  /**
   * Updates an API key owned by a specific user.
   *
   * @param id - The unique identifier of the API key to update.
   * @param userId - The unique identifier of the user who owns the API key.
   * @param data - The data to update the API key with.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the updated API key object.
   */
  updateUserApiKey: async (
    id: string,
    userId: string,
    data: Prisma.ApikeyUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Apikey> => {
    return tx.apikey.update({
      where: { id, userId },
      data,
    });
  },

  /**
   * Deletes an API key by its unique ID.
   *
   * @param id - The unique identifier of the API key to delete.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the deleted API key object.
   */
  deleteApiKey: async (
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Apikey> => {
    return tx.apikey.delete({
      where: { id },
    });
  },

  /**
   * Deletes an API key owned by a specific user.
   *
   * @param id - The unique identifier of the API key to delete.
   * @param userId - The unique identifier of the user who owns the API key.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the deleted API key object.
   */
  deleteUserApiKey: async (
    id: string,
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Apikey> => {
    return tx.apikey.delete({
      where: { id, userId },
    });
  },

  /**
   * Counts the number of API keys for a specific user.
   *
   * @param userId - The unique identifier of the user.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the count of API keys.
   */
  countUserApiKeys: async (
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<number> => {
    return tx.apikey.count({
      where: { userId },
    });
  },

  /**
   * Checks if an API key with the given name already exists for a user.
   *
   * @param userId - The unique identifier of the user.
   * @param name - The name to check for.
   * @param excludeId - (Optional) API key ID to exclude from the check (for updates).
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to true if a duplicate name exists, false otherwise.
   */
  checkDuplicateName: async (
    userId: string,
    name: string,
    excludeId?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<boolean> => {
    const existingKey = await tx.apikey.findFirst({
      where: {
        userId,
        name,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
    return !!existingKey;
  },
};
