import type { FileCollection, FileResource } from "@sokosumi/core-client";
import type { Dispatch, SetStateAction } from "react";
import {
  deleteDriveUploads,
  deleteFileCollection,
  type FileStore,
  updateFileCollection,
} from "@/lib/utils/file-search.client";

type SetCollections = Dispatch<SetStateAction<FileCollection[]>>;

/**
 * Show a collection's new name at once, then save it. Returns false when the
 * save failed; the old name is back by then, unless the name moved on again.
 */
export async function rename(
  store: FileStore,
  collection: FileCollection,
  name: string,
  setCollections: SetCollections,
): Promise<boolean> {
  const swap = (from: string, to: string) =>
    setCollections((list) =>
      list.map((entry) =>
        entry.id === collection.id && entry.name === from
          ? { ...entry, name: to }
          : entry,
      ),
    );
  swap(collection.name, name);
  try {
    await updateFileCollection({ store, collectionId: collection.id, name });
    return true;
  } catch {
    swap(name, collection.name);
    return false;
  }
}

/**
 * Take a collection off the shelf at once, then delete it. Returns false when
 * the delete failed; the collection is back in its old place by then.
 */
export async function remove(
  store: FileStore,
  collection: FileCollection,
  /** The shelf the reader pressed Delete on, for the place to put it back. */
  collections: readonly FileCollection[],
  setCollections: SetCollections,
): Promise<boolean> {
  const at = collections.findIndex((entry) => entry.id === collection.id);
  setCollections((list) => list.filter((entry) => entry.id !== collection.id));
  try {
    await deleteFileCollection({ store, collectionId: collection.id });
    return true;
  } catch {
    setCollections((list) =>
      list.some((entry) => entry.id === collection.id)
        ? list
        : [...list.slice(0, at), collection, ...list.slice(at)],
    );
    return false;
  }
}

/**
 * Take uploads off the list at once, then delete them. Returns the ids whose
 * delete failed. Those rows stay off the list: the caller loads it again.
 */
export async function deleteUploads<List extends { items: FileResource[] }>(
  targets: readonly FileResource[],
  setList: Dispatch<SetStateAction<List>>,
): Promise<string[]> {
  const gone = new Set(targets.map((item) => item.id));
  const hide = () =>
    setList((list) => ({
      ...list,
      items: list.items.filter((item) => !gone.has(item.id)),
    }));
  hide();
  const failedPathnames = await deleteDriveUploads(
    targets.flatMap((item) => (item.pathname ? [item.pathname] : [])),
  );
  // A page that loaded during the delete can hold the deleted rows again.
  hide();
  return targets
    .filter((item) => failedPathnames.includes(item.pathname ?? ""))
    .map((item) => item.id);
}
