import { randomUUID } from "node:crypto";

/**
 * An in-memory stand-in for the `sokoBotAvatar` and `sokoBot` delegates, so
 * avatar route tests can check what a caller is offered and what a claim
 * changes without a database. It understands the filters the avatar code
 * uses (equality, null, `not`, `in`, `notIn`, `contains`, `gte`, `lt`, `NOT`,
 * `OR`); anything else throws so a new filter is noticed, not ignored.
 */

export type AvatarRow = Record<string, unknown> & { id: string };

type Where = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    !Array.isArray(value)
  );
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function matchesField(value: unknown, condition: unknown): boolean {
  if (!isPlainObject(condition)) return same(value, condition);
  return Object.entries(condition).every(([op, operand]) => {
    switch (op) {
      case "not":
        return !matchesField(value, operand);
      case "in":
        return (operand as unknown[]).some((one) => same(value, one));
      case "notIn":
        return !(operand as unknown[]).some((one) => same(value, one));
      case "contains":
        return typeof value === "string" && value.includes(String(operand));
      case "gte":
        return value instanceof Date && value >= (operand as Date);
      case "lt":
        return value instanceof Date && value < (operand as Date);
      default:
        throw new Error(`soko-bot-avatar-store: unsupported filter "${op}"`);
    }
  });
}

export function matchesWhere(row: AvatarRow, where: Where = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "NOT") return !matchesWhere(row, condition as Where);
    if (key === "OR") {
      return (condition as Where[]).some((one) => matchesWhere(row, one));
    }
    if (key === "AND") {
      return (condition as Where[]).every((one) => matchesWhere(row, one));
    }
    return matchesField(row[key], condition);
  });
}

function project(row: AvatarRow, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.keys(select).map((key) => [key, row[key] ?? null]),
  );
}

export function createSokoBotAvatarStore() {
  const avatars: AvatarRow[] = [];
  const bots = new Map<string, Record<string, unknown>>();

  const sokoBotAvatar = {
    async findMany(args: {
      where?: Where;
      orderBy?: unknown;
      take?: number;
      select?: Record<string, boolean>;
    }) {
      const rows = avatars
        .filter((row) => matchesWhere(row, args.where))
        .sort(
          (a, b) =>
            (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
        );
      return rows
        .slice(0, args.take ?? rows.length)
        .map((row) => project(row, args.select));
    },
    async count(args: { where?: Where }) {
      return avatars.filter((row) => matchesWhere(row, args.where)).length;
    },
    async findUnique(args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }) {
      const row = avatars.find((one) => one.id === args.where.id);
      return row ? project(row, args.select) : null;
    },
    async create(args: {
      data: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) {
      const row: AvatarRow = {
        id: randomUUID(),
        createdAt: new Date(),
        claimedBySokoBotId: null,
        claimedAt: null,
        sourceUrl: null,
        reservedAt: null,
        requestedByUserId: null,
        ...args.data,
      };
      avatars.push(row);
      return project(row, args.select);
    },
    async update(args: {
      where: { id: string };
      data: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) {
      const row = avatars.find((one) => one.id === args.where.id);
      if (!row) throw new Error("Record to update not found");
      Object.assign(row, args.data);
      return project(row, args.select);
    },
    async updateMany(args: { where?: Where; data: Record<string, unknown> }) {
      const rows = avatars.filter((row) => matchesWhere(row, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    },
    async deleteMany(args: { where?: Where } = {}) {
      const keep = avatars.filter((row) => !matchesWhere(row, args.where));
      const count = avatars.length - keep.length;
      avatars.splice(0, avatars.length, ...keep);
      return { count };
    },
  };

  const sokoBot = {
    async update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) {
      const bot = { ...(bots.get(args.where.id) ?? {}), ...args.data };
      bots.set(args.where.id, bot);
      return { id: args.where.id, ...bot };
    },
  };

  const client = {
    sokoBotAvatar,
    sokoBot,
    async $transaction<T>(run: (tx: unknown) => Promise<T>) {
      return await run(client);
    },
  };

  /** Seed a published row; any field can be overridden. */
  function seed(row: Partial<AvatarRow> = {}): AvatarRow {
    const full: AvatarRow = {
      id: randomUUID(),
      createdAt: new Date(),
      subject: "owl",
      background: "gently muted sage green",
      seed: avatars.length + 1,
      model: "google/gemini-3.1-flash-image",
      imageUrl: `https://blob.test/avatar-${avatars.length + 1}.png`,
      sourceUrl: null,
      claimedBySokoBotId: null,
      claimedAt: null,
      requestedByUserId: null,
      reservedAt: null,
      ...row,
    };
    avatars.push(full);
    return full;
  }

  function reset() {
    avatars.splice(0, avatars.length);
    bots.clear();
  }

  return { client, avatars, bots, seed, reset };
}
