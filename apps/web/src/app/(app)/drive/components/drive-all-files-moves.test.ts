import type { FileCollection, FileResource } from "@sokosumi/core-client";
import type { SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStore } from "@/lib/utils/file-search.client";
import { deleteUploads, remove, rename } from "./drive-all-files-moves";

const api = vi.hoisted(() => ({
  updateFileCollection: vi.fn(),
  deleteFileCollection: vi.fn(),
  deleteDriveUploads: vi.fn(),
}));
vi.mock("@/lib/utils/file-search.client", () => api);
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

/** The translator, with the values it got spelled out. */
const t = (key: string, values: { name: string }) => `${key} ${values.name}`;
/** Nothing marked: for tests about the shelf, not the marker. */
const unmarked = () => {};

const store: FileStore = { scope: "me" };

/** A promise the test settles by hand, to look at the list during a save. */
function open<T>() {
  let resolve = (_: T) => {};
  let reject = (_: unknown) => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** React state without React: the list, and its setter. */
function held<T>(initial: T) {
  const box = { now: initial };
  const set = (next: SetStateAction<T>) => {
    box.now =
      typeof next === "function" ? (next as (now: T) => T)(box.now) : next;
  };
  return { box, set };
}

function shelf(...names: string[]): FileCollection[] {
  return names.map((name) => ({ id: name, name }) as FileCollection);
}

function uploads(...ids: string[]): FileResource[] {
  return ids.map((id) => ({ id, pathname: `files/${id}` }) as FileResource);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renaming a collection", () => {
  it("shows the new name during the save and keeps it", async () => {
    const save = open<void>();
    api.updateFileCollection.mockReturnValueOnce(save.promise);
    const { box, set } = held(shelf("a", "b"));

    const done = rename(store, box.now[0], "new", set, unmarked, t);
    expect(box.now.map((entry) => entry.name)).toEqual(["new", "b"]);
    expect(api.updateFileCollection).toHaveBeenCalledWith({
      store,
      collectionId: "a",
      name: "new",
    });

    save.resolve();
    expect(await done).toBe(true);
    expect(box.now.map((entry) => entry.name)).toEqual(["new", "b"]);
  });

  it("puts the old name back when the save fails", async () => {
    api.updateFileCollection.mockRejectedValueOnce(new Error("offline"));
    const { box, set } = held(shelf("a", "b"));

    const saved = await rename(store, box.now[0], "new", set, unmarked, t);

    expect(saved).toBe(false);
    expect(box.now.map((entry) => entry.name)).toEqual(["a", "b"]);
    // The earlier name: the one the shelf shows again.
    expect(toastError).toHaveBeenCalledWith("collectionRenameFailed a");
  });

  it("marks the collection as saving until the save answers", async () => {
    const save = open<void>();
    api.updateFileCollection.mockReturnValueOnce(save.promise);
    const { box, set } = held(shelf("a", "b"));
    const renaming = held<string | null>(null);

    const done = rename(store, box.now[0], "new", set, renaming.set, t);
    expect(renaming.box.now).toBe("a");

    save.resolve();
    await done;
    expect(renaming.box.now).toBeNull();
  });

  it("drops the mark when the save fails", async () => {
    api.updateFileCollection.mockRejectedValueOnce(new Error("offline"));
    const { box, set } = held(shelf("a"));
    const renaming = held<string | null>(null);

    await rename(store, box.now[0], "new", set, renaming.set, t);

    expect(renaming.box.now).toBeNull();
  });

  it("leaves a name that moved on during a failed save", async () => {
    const save = open<void>();
    api.updateFileCollection.mockReturnValueOnce(save.promise);
    const { box, set } = held(shelf("a"));

    const done = rename(store, box.now[0], "new", set, unmarked, t);
    // A reload brought what Core holds now.
    set([{ ...box.now[0], name: "from Core" }]);
    save.reject(new Error("offline"));

    expect(await done).toBe(false);
    expect(box.now[0].name).toBe("from Core");
    // The name the reader acted on; the copy claims no restored name.
    expect(toastError).toHaveBeenCalledWith("collectionRenameFailed a");
  });
});

describe("removing a collection", () => {
  it("takes it off the shelf during the delete", async () => {
    const save = open<void>();
    api.deleteFileCollection.mockReturnValueOnce(save.promise);
    const { box, set } = held(shelf("a", "b", "c"));

    const done = remove(store, box.now[1], box.now, set, t);
    expect(box.now.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(api.deleteFileCollection).toHaveBeenCalledWith({
      store,
      collectionId: "b",
    });

    save.resolve();
    expect(await done).toBe(true);
    expect(box.now.map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("puts it back in its place when the delete fails", async () => {
    api.deleteFileCollection.mockRejectedValueOnce(new Error("offline"));
    const { box, set } = held(shelf("a", "b", "c"));

    const removed = await remove(store, box.now[1], box.now, set, t);

    expect(removed).toBe(false);
    expect(box.now.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(toastError).toHaveBeenCalledWith("collectionDeleteFailed b");
  });

  it("does not add a second copy when a reload already brought it back", async () => {
    const save = open<void>();
    api.deleteFileCollection.mockReturnValueOnce(save.promise);
    const all = shelf("a", "b");
    const { box, set } = held(all);

    const done = remove(store, all[1], all, set, t);
    set(all);
    save.reject(new Error("offline"));

    expect(await done).toBe(false);
    expect(box.now.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("deleting uploads", () => {
  it("takes the rows off the list during the delete", async () => {
    const save = open<string[]>();
    api.deleteDriveUploads.mockReturnValueOnce(save.promise);
    const { box, set } = held({ items: uploads("a", "b", "c") });

    const done = deleteUploads([box.now.items[0], box.now.items[2]], set);
    expect(box.now.items.map((item) => item.id)).toEqual(["b"]);
    expect(api.deleteDriveUploads).toHaveBeenCalledWith(["files/a", "files/c"]);

    save.resolve([]);
    expect(await done).toEqual([]);
  });

  it("names the rows whose delete failed", async () => {
    api.deleteDriveUploads.mockResolvedValueOnce(["files/c"]);
    const { box, set } = held({ items: uploads("a", "b", "c") });

    expect(
      await deleteUploads([box.now.items[0], box.now.items[2]], set),
    ).toEqual(["c"]);
  });

  it("takes off rows that a page brought back during the delete", async () => {
    const save = open<string[]>();
    api.deleteDriveUploads.mockReturnValueOnce(save.promise);
    const all = uploads("a", "b");
    const { box, set } = held({ items: all });

    const done = deleteUploads([all[0]], set);
    set({ items: all });
    save.resolve([]);
    await done;

    expect(box.now.items.map((item) => item.id)).toEqual(["b"]);
  });
});
