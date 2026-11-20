export interface DomPropertyAdapter<V> {
  read: (key: string) => V;
  write: (key: string, value: V) => void;
}

/**
 * Module-level owner stack per DOM property key so overlapping mounts and
 * React `<Activity>` hide/reveal transitions restore the remaining top owner's
 * value (or the pre-existing value once the last owner releases).
 */
export function createDomPropertyStack<V>(adapter: DomPropertyAdapter<V>) {
  const stacks = new Map<
    string,
    { base: V; entries: Array<{ owner: symbol; value: V }> }
  >();

  return function claim(key: string, value: V): () => void {
    const owner = Symbol();
    let slot = stacks.get(key);
    if (!slot) {
      slot = { base: adapter.read(key), entries: [] };
      stacks.set(key, slot);
    }
    slot.entries.push({ owner, value });
    adapter.write(key, value);

    return () => {
      const current = stacks.get(key);
      if (!current) return;
      const index = current.entries.findIndex((entry) => entry.owner === owner);
      if (index === -1) return;
      current.entries.splice(index, 1);
      const top = current.entries.at(-1);
      if (top) {
        adapter.write(key, top.value);
      } else {
        stacks.delete(key);
        adapter.write(key, current.base);
      }
    };
  };
}
