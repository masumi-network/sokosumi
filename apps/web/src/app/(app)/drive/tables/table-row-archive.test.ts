import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../../messages/en.json";
import { createTableMutations } from "./table-mutations";
import { saveArchive } from "./table-row-archive";

const t = createTranslator({
  locale: "en",
  messages: en,
  namespace: "App.Tables",
});
const row = (id: string, archived: boolean) => ({ id, version: 1, archived });
const SLOT = "archive-rows";

describe("saveArchive", () => {
  it("counts the archived rows a rejected save puts back", async () => {
    const save = saveArchive(
      t,
      SLOT,
      [row("a", true), row("b", true)],
      createTableMutations(),
      () => Promise.reject({ error: "Forbidden", message: "No" }),
    );
    await expect(save).rejects.toThrow(
      "Could not archive 2 rows. They are back in the table. You no longer have permission for this operation.",
    );
  });
  it("names one restored row and puts it back in archived rows", async () => {
    const save = saveArchive(
      t,
      SLOT,
      [row("a", false)],
      createTableMutations(),
      () => Promise.reject({ error: "Conflict", message: "Stale" }),
    );
    await expect(save).rejects.toThrow(
      /^Could not restore 1 row\. It is back in archived rows\. The data changed/,
    );
  });
  it("does not claim missing rows came back", async () => {
    const missing = { error: "NotFound", message: "Gone" };
    const save = saveArchive(
      t,
      SLOT,
      [row("a", true)],
      createTableMutations(),
      () => Promise.reject(missing),
    );
    await expect(save).rejects.toBe(missing);
  });
  it("keeps a failure that may have committed as it is, for Retry", async () => {
    const mutate = createTableMutations();
    const lost = new Error("socket hang up");
    const save = saveArchive(t, SLOT, [row("a", true)], mutate, () =>
      Promise.reject(lost),
    );
    await expect(save).rejects.toBe(lost);
    expect(mutate.isPending(SLOT)).toBe(true);
  });
});
