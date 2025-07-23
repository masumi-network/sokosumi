import "server-only";

import prisma from "@/lib/db/repositories/prisma";
import { Prisma } from "@/prisma/generated/client";

/**
 * Abstract base class for services that implement the singleton pattern.
 *
 * This class provides automatic singleton instance management and transaction support
 * without requiring any boilerplate code in subclasses.
 *
 * Usage:
 * ```typescript
 * export class MyService extends BaseService<MyService> {
 *   // Only business logic methods - no singleton boilerplate needed!
 *   async myMethod() {
 *     return this.client.myTable.findMany();
 *   }
 * }
 *
 * // Usage:
 * const service = MyService.getInstance(); // Singleton with default client
 * const txService = MyService.createInstance(tx); // New instance with transaction client
 * ```
 */
export abstract class BaseService<T extends BaseService<T>> {
  /**
   * Constructor for creating service instances.
   * While public, instances should typically be created via getInstance() or createInstance().
   * @param client Prisma transaction client for database operations.
   */
  constructor(protected client: Prisma.TransactionClient) {}

  /**
   * Get the singleton instance of the service using the default Prisma client,
   * or create a new instance with a specific transaction client.
   * This method is automatically available on all subclasses with correct typing.
   *
   * @param client Optional Prisma transaction client. If provided, creates a new instance.
   *               If undefined or null, returns the singleton instance.
   * @returns The service instance (singleton or new instance based on client parameter).
   */
  static getInstance<T extends BaseService<T>>(
    this: new (client: Prisma.TransactionClient) => T,
    client?: Prisma.TransactionClient | null,
  ): T {
    // If client is provided, create a new instance
    if (client) {
      return new this(client);
    }

    // Otherwise, return the singleton instance
    const constructor = this as unknown as typeof BaseService & {
      instance?: T;
    };
    constructor.instance ??= new this(prisma);
    return constructor.instance;
  }

  /**
   * Create a new instance of the service with a specific Prisma transaction client.
   * This method is automatically available on all subclasses with correct typing.
   *
   * @param client Prisma transaction client to use for all operations.
   * @returns A new service instance bound to the provided client.
   */
  static createInstance<T extends BaseService<T>>(
    this: new (client: Prisma.TransactionClient) => T,
    client: Prisma.TransactionClient,
  ): T {
    return new this(client);
  }
}
