/**
 * The shape of an untrusted response, for a log: the dotted paths made only
 * of keys in `known`, and how many other keys it had. A provider's keys can
 * be private text (`{ "Ada's launch plan": true }`), so an unknown key is
 * counted, never named, and nothing under it is read.
 */
export function knownKeyPaths(
  value: unknown,
  known: ReadonlySet<string>,
  maxDepth: number,
): { keyPaths: string[]; otherKeys: number } {
  const keyPaths: string[] = [];
  let otherKeys = 0;
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (depth > maxDepth) return;
    for (const [key, nested] of Object.entries(node)) {
      if (!known.has(key)) {
        otherKeys += 1;
        continue;
      }
      const path = prefix ? `${prefix}.${key}` : key;
      keyPaths.push(path);
      walk(nested, path, depth + 1);
    }
  };
  walk(value, "", 0);
  return { keyPaths, otherKeys };
}
