// Loaded with `node --import` by env-startup.test.ts: prints every file the
// process loads, and every builtin a file outside node_modules imports, so the
// test can see what the deploy step pulls in. Builtins are recorded where they
// are resolved: a builtin tsx loaded first is not loaded again.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    const parent = context.parentURL ?? "";
    if (resolved.url.startsWith("node:") && !parent.includes("/node_modules/"))
      process.stderr.write(`LOADED ${resolved.url}\n`);
    return resolved;
  },
  load(url, context, next) {
    if (url.startsWith("file:")) process.stderr.write(`LOADED ${url}\n`);
    return next(url, context);
  },
});
