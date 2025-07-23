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
   * WeakMap to store singleton instances for each service class.
   * WeakMap provides better memory management and cleanup when classes are garbage collected.
   */
  private static instances = new WeakMap<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (client: Prisma.TransactionClient) => BaseService<any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    BaseService<any>
  >();

  /**
   * Constructor for creating service instances.
   * While public, instances should typically be created via getInstance() or createInstance().
   * @param client Prisma transaction client for database operations.
   */
  constructor(protected client: Prisma.TransactionClient) {}

  /**
   * Get the singleton instance of the service using the default Prisma client.
   * This method is automatically available on all subclasses with correct typing.
   *
   * @returns The singleton instance of the service.
   */
  static getInstance<T extends BaseService<T>>(
    this: new (client: Prisma.TransactionClient) => T,
  ): T {
    if (!BaseService.instances.has(this)) {
      BaseService.instances.set(this, new this(prisma));
    }
    return BaseService.instances.get(this) as T;
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

  /**
   * Reset all singleton instances. Useful for testing.
   * @internal
   */
  static resetAllInstances(): void {
    // WeakMap doesn't have a clear method, so we create a new instance
    BaseService.instances = new WeakMap();
  }

  /**
   * Reset the singleton instance for a specific service class. Useful for testing.
   * @internal
   */
  static resetInstance<T extends BaseService<T>>(
    this: new (client: Prisma.TransactionClient) => T,
  ): void {
    BaseService.instances.delete(this);
  }
}
