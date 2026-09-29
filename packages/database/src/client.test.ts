import { Client, Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPrismaClient } from "./client.js";

const DATABASE_URL = "postgresql://test:test@localhost:5432/test";
const QUERY_RESULT = {
  command: "SELECT",
  rowCount: 1,
  oid: 0,
  fields: [
    {
      name: "value",
      tableID: 0,
      columnID: 0,
      dataTypeID: 23,
      dataTypeSize: 4,
      dataTypeModifier: -1,
      format: "text",
    },
  ],
  rows: [[42]],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPrismaClient", () => {
  it("queries through a connection string for scripts and tests", async () => {
    vi.spyOn(Pool.prototype, "query").mockImplementation(() =>
      Promise.resolve(QUERY_RESULT),
    );
    const prisma = createPrismaClient(DATABASE_URL);
    try {
      await expect(prisma.$queryRaw`SELECT 42 AS value`).resolves.toEqual([
        { value: 42 },
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("queries through a supplied pool without closing the caller's pool", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    vi.spyOn(pool, "query").mockImplementation(() =>
      Promise.resolve(QUERY_RESULT),
    );
    const prisma = createPrismaClient(pool);
    try {
      await expect(prisma.$queryRaw`SELECT 42 AS value`).resolves.toEqual([
        { value: 42 },
      ]);
      await prisma.$disconnect();
      expect(pool.ended).toBe(false);
      await expect(pool.query("SELECT 42 AS value")).resolves.toEqual(
        QUERY_RESULT,
      );
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });

  it("reports idle pool errors and preserves query failures", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const error = new Error("Connection terminated unexpectedly");
    vi.spyOn(pool, "query").mockImplementation(() => Promise.reject(error));
    const onPoolError = vi.fn();
    const prisma = createPrismaClient(pool, { onPoolError });
    try {
      await prisma.$connect();
      pool.emit("error", error);
      expect(onPoolError).toHaveBeenCalledWith(error);
      await expect(prisma.$queryRaw`SELECT 42 AS value`).rejects.toThrow(
        "Connection terminated unexpectedly",
      );
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });

  it("reports errors from a connection checked out by a transaction", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const connection = Object.assign(new Client(), { release: vi.fn() });
    vi.spyOn(pool, "connect").mockImplementation(() =>
      Promise.resolve(connection),
    );
    vi.spyOn(connection, "query").mockImplementation(() =>
      Promise.resolve(QUERY_RESULT),
    );
    const onConnectionError = vi.fn();
    const prisma = createPrismaClient(pool, { onConnectionError });
    const error = new Error("Transaction connection terminated unexpectedly");
    try {
      await prisma.$transaction(async () => {
        connection.emit("error", error);
        expect(onConnectionError).toHaveBeenCalledWith(error);
      });
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });
});
