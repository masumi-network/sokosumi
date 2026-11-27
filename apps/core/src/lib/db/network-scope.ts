import type { Prisma, SharedDb } from "@sokosumi/database";
import type { PrismaRaw } from "@sokosumi/database/client";
import {
  type NetworkModelName,
  type NetworkTableName,
  netTable,
} from "@sokosumi/database/sql-tables";

import { type Network, requireNetworkOn } from "@/lib/network";

import prisma, { networkPrisma } from "./prisma";
import { retriedTransaction, retriedTransactionOn } from "./transaction";

type NetworkModel = Uncapitalize<NetworkModelName>;
type Tx = Prisma.TransactionClient;

type NetworkSide = Pick<Tx, NetworkModel | "$queryRaw" | "$executeRaw">;

declare const networkSide: unique symbol;

/**
 * The Network side, a client or an open transaction: the Network models and
 * tagged raw SQL. Take the whole type in a helper, not a `Pick` of it: the
 * brand exists in the types only, and without it the default client is
 * accepted again.
 */
export type NetworkDb = NetworkSide & { readonly [networkSide]: true };

/**
 * The shared side, a client or an open transaction: every other model. The
 * database package owns the definition, because its repositories take it.
 */
export type { SharedDb };

/**
 * What Core's database module hands out for work on one Network. An entry
 * point creates it; code below receives it, or one side of it, as an argument.
 */
export interface NetworkScope {
  readonly network: Network;
  /** This Network's client, built on first read. */
  readonly networkDb: NetworkDb;
  readonly sharedDb: SharedDb;
  /** A table of this Network with its schema, for raw SQL. */
  networkTable(table: NetworkTableName): PrismaRaw.Sql;
  /**
   * A transaction on this Network's client, with the retry and conflict rules
   * of `retriedTransaction`: the callback can run up to 8 times. Shared rows:
   * raw SQL with `sharedTable`. Inside, use `tx`, not `networkDb`.
   */
  netTransaction<T>(
    callback: (tx: NetworkDb) => Promise<T>,
    conflictMessage: string,
    isolationLevel?: Prisma.TransactionIsolationLevel,
  ): Promise<T>;
  /**
   * The same on the shared client. Network rows: raw SQL with `networkTable`.
   * Inside, use `tx`, not `sharedDb`.
   */
  sharedTransaction<T>(
    callback: (tx: SharedDb) => Promise<T>,
    conflictMessage: string,
    isolationLevel?: Prisma.TransactionIsolationLevel,
  ): Promise<T>;
}

/**
 * The only way to a Network's client. Throws for an unknown Network and for
 * Preprod while Preprod is off. Builds no client and reads nothing from the
 * client module, which most unit tests mock with a default export only.
 */
export function createNetworkScope(network: Network): NetworkScope {
  const known = requireNetworkOn(network);
  return {
    network: known,
    get networkDb() {
      // The client itself: the brand is in the types only.
      const client: NetworkSide = networkPrisma(known);
      return client as NetworkDb;
    },
    get sharedDb() {
      return prisma;
    },
    networkTable: (table) => netTable(known, table),
    netTransaction: (callback, conflictMessage, isolationLevel) =>
      retriedTransactionOn(
        networkPrisma(known),
        (tx) => {
          // The transaction itself: the brand is in the types only.
          const side: NetworkSide = tx;
          return callback(side as NetworkDb);
        },
        conflictMessage,
        isolationLevel,
      ),
    sharedTransaction: (callback, conflictMessage, isolationLevel) =>
      retriedTransaction(callback, conflictMessage, isolationLevel),
  };
}

/**
 * A scope for a request that names a Network it may not use: its Network side
 * (`network`, `networkDb`, `networkTable`, `netTransaction`) throws `refusal`
 * on first use, its shared side works. So only work on Network data is
 * refused.
 */
export function createRefusedNetworkScope(refusal: Error): NetworkScope {
  const refuse = (): never => {
    throw refusal;
  };
  return {
    get network() {
      return refuse();
    },
    get networkDb() {
      return refuse();
    },
    get sharedDb() {
      return prisma;
    },
    networkTable: refuse,
    netTransaction: async () => refuse(),
    sharedTransaction: (callback, conflictMessage, isolationLevel) =>
      retriedTransaction(callback, conflictMessage, isolationLevel),
  };
}
