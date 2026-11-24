// Loaded with `node --import` by env-startup.test.ts: prints every file the
// process loads, so the test can see what the deploy step pulls in.
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, next) {
    if (url.startsWith("file:")) process.stderr.write(`LOADED ${url}\n`);
    return next(url, context);
  },
});
