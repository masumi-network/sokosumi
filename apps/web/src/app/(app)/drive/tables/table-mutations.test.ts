import { describe, expect, it, vi } from "vitest";
import { createTableMutations } from "./table-mutations";

describe("unresolved table mutations", () => {
  it.each(["add-row", "save-view", "undo:batch", "cell:row:column"])(
    "retries %s verbatim after lost acknowledgement",
    async (slot) => {
      const mutate = createTableMutations();
      const send = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("network error"))
        .mockResolvedValue({ id: "committed" });
      const input = { version: 1, value: "original" };
      await expect(mutate(slot, input, send)).rejects.toThrow();
      expect(mutate.isPending(slot)).toBe(true);
      expect(mutate.isPending("unrelated")).toBe(false);
      await expect(
        mutate(slot, { ...input, value: "changed" }, send),
      ).rejects.toThrow("previous request");
      expect(send).toHaveBeenCalledTimes(1);
      await expect(mutate(slot, input, send)).resolves.toEqual({
        id: "committed",
      });
      expect(mutate.isPending(slot)).toBe(false);
      expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
      await mutate(slot, input, send);
      expect(send.mock.calls[2][0].key).not.toBe(send.mock.calls[0][0].key);
    },
  );
  it("releases definitively rejected inputs for correction", async () => {
    const mutate = createTableMutations();
    const send = vi
      .fn()
      .mockRejectedValueOnce({ error: "UnprocessableEntity" })
      .mockResolvedValue({});
    await expect(mutate("view", { name: "" }, send)).rejects.toBeDefined();
    await mutate("view", { name: "Fixed" }, send);
    expect(send.mock.calls[1][0].name).toBe("Fixed");
  });
  it("snapshots nested payloads independently of caller-owned objects", async () => {
    const mutate = createTableMutations();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("lost ack"))
      .mockResolvedValue({});
    const body = { patch: [{ id: "row", version: 1 }] };
    await expect(mutate("archive", body, send)).rejects.toThrow();
    body.patch[0].version = 2;
    await mutate("archive", { patch: [{ id: "row", version: 1 }] }, send);
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    expect(send.mock.calls[1][0].patch[0].version).toBe(1);
  });
});
