/**
 * Starts Core's logger as a side effect, once per process. `config/env.ts`
 * imports it: the startup environment check runs on the first environment
 * read, often while modules are still loading, and reports through this
 * logger, redacted and on Core's drain. An import in `src/index.ts` would not
 * do: the bundle evaluates its chunks before the entry's own code.
 *
 * The flag lives on `globalThis`, so a module registry reset does not start
 * it again. The test setup sets it up front: there the test drain owns evlog.
 */
import { initCoreLogger } from "./evlog.js";

const STARTED = Symbol.for("sokosumi.core.logger-started");
const scope = globalThis as { [STARTED]?: true };

if (!scope[STARTED]) {
  scope[STARTED] = true;
  initCoreLogger();
}
