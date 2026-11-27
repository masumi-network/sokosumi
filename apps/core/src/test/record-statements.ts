import { Client, Pool } from "pg";
import { vi } from "vitest";

/** Every statement the pool's connections send, with its bound values. */
export function recordStatements() {
  const statements: unknown[][] = [];
  const texts: string[] = [];
  const checkouts: unknown[] = [];
  const emit = Pool.prototype.emit;
  const acquireSpy = vi
    .spyOn(Pool.prototype, "emit")
    .mockImplementation(function (this: Pool, event, ...args) {
      if (event === "acquire") checkouts.push(args[0]);
      return emit.call(this, event, ...args);
    });
  const query = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
    this: Client,
    ...args: unknown[]
  ) {
    const [first, second] = args as [unknown, unknown];
    texts.push(
      typeof first === "string"
        ? first
        : ((first as { text?: string } | undefined)?.text ?? ""),
    );
    const values =
      typeof first === "object" && first !== null && "values" in first
        ? (first as { values?: unknown[] }).values
        : second;
    statements.push(Array.isArray(values) ? values : []);
    return (query as (...a: unknown[]) => unknown).apply(this, args);
  } as never);
  return {
    statements,
    texts,
    checkouts,
    restore: () => {
      spy.mockRestore();
      acquireSpy.mockRestore();
    },
  };
}
