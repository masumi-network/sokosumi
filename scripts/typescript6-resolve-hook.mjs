/**
 * Redirects the `typescript` package specifier to `@typescript/typescript6`
 * so codegen tools that still need the TS6 JS compiler API keep working when
 * the workspace `typescript` dependency is TypeScript 7 (native CLI only).
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "typescript" || specifier.startsWith("typescript/")) {
    return nextResolve(
      specifier.replace(/^typescript/, "@typescript/typescript6"),
      context,
    );
  }
  return nextResolve(specifier, context);
}
