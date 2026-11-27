import { Client } from "pg";
import { vi } from "vitest";

/** Every statement the pool's connections send, with its bound values. */
export function recordStatements() {
  const statements: unknown[][] = [];
  const query = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
    this: Client,
    ...args: unknown[]
  ) {
    const [first, second] = args as [unknown, unknown];
    const values =
      typeof first === "object" && first !== null && "values" in first
        ? (first as { values?: unknown[] }).values
        : second;
    statements.push(Array.isArray(values) ? values : []);
    return (query as (...a: unknown[]) => unknown).apply(this, args);
  } as never);
  return { statements, restore: () => spy.mockRestore() };
}
