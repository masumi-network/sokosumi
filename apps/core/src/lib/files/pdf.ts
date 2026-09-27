import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Reading the text layer out of a PDF, in a process that may be killed.
 *
 * ## Why a separate process
 *
 * Everything else in `extraction.ts` runs in the API process because it is
 * ours: a character scan over decoded text, or a ZIP read through `jszip`
 * with hand-written caps. A PDF is different in kind. `pdfjs-dist` is 35 MB
 * of interpreter for a format with an embedded imaging model, and it runs
 * over bytes a reader uploaded. The honest position is that we cannot bound
 * what it does from the inside, so the bound is placed around it: a child
 * process with its own heap, killed from the outside when it runs long.
 *
 * A worker thread was the alternative and is rejected. It shares the
 * process. `worker.terminate()` is cooperative at the V8 level and a heap
 * limit breach in a worker is recoverable, but neither is a guarantee about
 * the *process*, and the requirement here is that a malformed PDF cannot
 * take the API down with it. A killed child is a guarantee.
 *
 * ## Why the child program is a string
 *
 * Core builds to a single bundled `dist/index.js` (`tsup`, one entry) and
 * runs as `node dist/index.js`. A forked child needs a real file on disk,
 * which would mean a second build entry and a path that differs between
 * `tsx src/` in development and `dist/` in production. That difference is
 * the classic shape of "worked locally, 500 in production", and it would
 * land on the one path whose whole purpose is not to 500.
 *
 * Passing the program with `node -e` removes the file from the problem
 * entirely. The bytes go over stdin rather than argv, because argv is
 * length-limited and a PDF is not.
 *
 * ## What bounds an adversarial file
 *
 * Four bounds, and each is enforced **while** the work happens rather than
 * before or after it. That distinction is not pedantic: the zip-bomb defect
 * in `ooxml.ts` was a pre-check reading an attacker-supplied number, and a
 * post-check is a check that runs once the memory is already spent.
 *
 * - **Pages** — the child stops the page loop at `PDF_MAX_PAGES`. A
 *   50,000-page document is 200 pages of work, not 50,000.
 * - **Output characters** — the child stops as soon as what it has
 *   accumulated reaches `PDF_MAX_OUTPUT_CHARS`, mid-document, and says it
 *   truncated.
 * - **Wall clock** — the **parent** holds the timer and sends `SIGKILL`.
 *   A timer inside the child would never fire while the child is inside a
 *   synchronous loop, which is exactly the case it exists for.
 * - **Heap** — `--max-old-space-size` on the child. Exhausting it aborts
 *   the child, not the API.
 *
 * A fifth bound sits on our side of the pipe: the parent stops reading
 * stdout past `PDF_MAX_STDOUT_BYTES`. The child is the component we do not
 * trust here, so its output is bounded like any other untrusted input.
 *
 * ## No OCR
 *
 * A scanned page has no text layer and stays unsupported with a reason. No
 * attempt is made to detect "is this a scan" beyond observing that nothing
 * was extracted, because guessing produces a document that reads as
 * searched and is not.
 */

/** Pages read from one document, however many it claims to have. */
export const PDF_MAX_PAGES = 200;
/** Characters accumulated before the child stops and reports truncation. */
export const PDF_MAX_OUTPUT_CHARS = 1_000_000;
/** Wall clock for the whole child, enforced by the parent with SIGKILL. */
export const PDF_TIMEOUT_MS = 20_000;
/** Heap ceiling for the child process, in megabytes. */
export const PDF_MAX_HEAP_MB = 512;
/** Stdout the parent will accept from the child before giving up on it. */
export const PDF_MAX_STDOUT_BYTES = 8 * 1024 * 1024;

export type PdfFailure =
  | "parser-unavailable"
  | "timeout"
  | "out-of-memory"
  | "crashed"
  | "unreadable"
  | "encrypted"
  | "no-text-layer";

export type PdfOutcome =
  | {
      ok: true;
      text: string;
      /** Pages actually read. */
      pages: number;
      /** Pages the document claims, so coverage has an honest denominator. */
      totalPages: number;
      truncated: boolean;
    }
  | { ok: false; failure: PdfFailure };

/**
 * The child program.
 *
 * Reads the PDF from stdin, writes one JSON line to stdout, exits. It never
 * throws out of the top level: an exception here would be reported to the
 * parent as a crash, which is true but less useful than a named cause.
 *
 * `isEvalSupported: false` matters. pdfjs will otherwise compile parts of a
 * document's content streams with `Function`, which is executing bytes the
 * reader supplied. Fonts are disabled for the same reason and because text
 * extraction does not need them.
 */
const CHILD_PROGRAM = `
const MAX_PAGES = Number(process.env.PDF_MAX_PAGES);
const MAX_CHARS = Number(process.env.PDF_MAX_OUTPUT_CHARS);

function say(value) {
  process.stdout.write(JSON.stringify(value));
}

async function readStdin() {
  const parts = [];
  for await (const part of process.stdin) parts.push(part);
  return new Uint8Array(Buffer.concat(parts));
}

async function main() {
  const bytes = await readStdin();

  let pdfjs;
  try {
    // An absolute file URL handed over by the parent, which already
    // resolved it. The child never does module resolution of its own.
    pdfjs = await import(process.env.PDFJS_ENTRY_URL);
  } catch {
    say({ ok: false, failure: "parser-unavailable" });
    return;
  }

  // Named explicitly rather than left to pdfjs's relative default, which
  // its fake worker resolves with a dynamic import.
  if (process.env.PDFJS_WORKER_URL && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = process.env.PDFJS_WORKER_URL;
  }

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      standardFontDataUrl: undefined,
      verbosity: 0,
    }).promise;
  } catch (error) {
    const name = String((error && error.name) || "");
    if (name === "PasswordException") {
      say({ ok: false, failure: "encrypted" });
      return;
    }
    say({ ok: false, failure: "unreadable" });
    return;
  }

  // Page cap and character cap, both checked as the loop runs. The loop is
  // the only place either could be exceeded, so it is the only place they
  // are enforced.
  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  let text = "";
  let truncated = doc.numPages > MAX_PAGES;
  let pagesRead = 0;

  for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
    let page;
    try {
      page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        pageText += item.str;
        if (item.hasEOL) pageText += "\\n";
      }
      text += (pagesRead > 0 ? "\\n\\n" : "") + pageText;
      pagesRead += 1;
    } catch {
      // One unreadable page does not condemn the document. Stop here and
      // report what was read, which is what a partial result means.
      truncated = true;
      break;
    } finally {
      if (page && typeof page.cleanup === "function") page.cleanup();
    }

    if (text.length >= MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      truncated = true;
      break;
    }
  }

  if (text.trim().length === 0) {
    say({ ok: false, failure: "no-text-layer" });
    return;
  }

  say({ ok: true, text, pages: pagesRead, totalPages: doc.numPages, truncated });
}

main().then(
  () => process.exit(0),
  () => {
    try {
      say({ ok: false, failure: "unreadable" });
    } catch {}
    process.exit(0);
  },
);
`;

/**
 * The absolute path of the pdfjs entry point, resolved by the **parent**.
 *
 * The child could resolve `pdfjs-dist` itself from its working directory,
 * and the first version did. Two reasons not to.
 *
 * The first is honesty about failure. Resolving here means a missing
 * parser is known *before* a process is spawned, so the outcome is
 * `parser-unavailable` for the reason it says, rather than a child that
 * starts, fails an import and has to report that back over a pipe.
 *
 * The second is deployment, and it is the one that would have bitten. This
 * module never statically imports pdfjs — only the child program does, in
 * a dynamic `import()` inside a template literal, which no bundler or
 * file tracer can see. Vercel traces `dist/index.js` to decide what to
 * ship; a specifier that exists only inside a string is invisible to it,
 * and `pdfjs-dist` would simply not be in the function. The parser would
 * then be "unavailable" in production as the *normal* case while every
 * test passed locally. A literal `require.resolve` here is something a
 * tracer can see, and `apps/core/vercel.json` names the files explicitly
 * as well, because one mechanism for this is not enough.
 */
const PDFJS_SPECIFIER = "pdfjs-dist/legacy/build/pdf.mjs";
/**
 * The worker module, which is **also** loaded and is easy to miss.
 *
 * In Node, pdfjs disables the real worker and sets
 * `GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"`, then its fake
 * worker does `await import(this.workerSrc)`. So the worker file is
 * dynamically imported on precisely the path this module uses, and a bundle
 * carrying `pdf.mjs` alone would fail one layer deeper — with the same
 * symptom, `parser-unavailable` on every document, and the same
 * indistinguishability from a scan.
 *
 * Resolving it here and setting `workerSrc` explicitly means the file is
 * named by a literal specifier a tracer can see, and the child never relies
 * on a relative default resolving the way we assume.
 */
const PDFJS_WORKER_SPECIFIER = "pdfjs-dist/legacy/build/pdf.worker.mjs";

function resolveFrom(specifier: string): string | null {
  try {
    return createRequire(import.meta.url).resolve(specifier);
  } catch {
    return null;
  }
}

function resolvePdfjsEntry(): string | null {
  return resolveFrom(PDFJS_SPECIFIER);
}

function resolvePdfjsWorker(): string | null {
  return resolveFrom(PDFJS_WORKER_SPECIFIER);
}

function childWorkingDirectory(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export interface PdfExtractDependencies {
  /** Overridable so tests can drive the failure modes for real. */
  spawnChild?: typeof spawn;
  timeoutMs?: number;
  maxHeapMb?: number;
  childProgram?: string;
  /**
   * The page and character caps, lowered by tests.
   *
   * Lowering them rather than building a 200-page fixture keeps the test
   * fast, and it exercises the same loop with the same comparison — the
   * production values reach the child through this identical path, and
   * there is a test asserting that the defaults sent are the exported
   * constants. A cap that is only ever tested at its production value is
   * a cap nobody has watched fire.
   */
  maxPages?: number;
  maxOutputChars?: number;
  /** The parent-side stdout bound, lowered by tests. */
  maxStdoutBytes?: number;
  /**
   * The resolved pdfjs entry point. Tests point it at nothing to drive the
   * missing-parser path without uninstalling the package.
   */
  pdfjsEntry?: string | null;
  /** The resolved pdfjs worker module; see `PDFJS_WORKER_SPECIFIER`. */
  pdfjsWorker?: string | null;
}

/**
 * Extract the text layer from one PDF. Never throws.
 *
 * Every outcome is a value, because the caller is an indexing job whose
 * contract is that it completes. A throw here would retry forever against a
 * document that will never parse.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  dependencies: PdfExtractDependencies = {},
): Promise<PdfOutcome> {
  const spawnChild = dependencies.spawnChild ?? spawn;
  const timeoutMs = dependencies.timeoutMs ?? PDF_TIMEOUT_MS;
  const maxHeapMb = dependencies.maxHeapMb ?? PDF_MAX_HEAP_MB;
  const program = dependencies.childProgram ?? CHILD_PROGRAM;
  const maxPages = dependencies.maxPages ?? PDF_MAX_PAGES;
  const maxOutputChars = dependencies.maxOutputChars ?? PDF_MAX_OUTPUT_CHARS;
  const maxStdoutBytes = dependencies.maxStdoutBytes ?? PDF_MAX_STDOUT_BYTES;

  // `in` rather than `??`: an explicit `null` means "there is no parser",
  // which is the case under test, and `??` would read it as "not supplied"
  // and resolve one anyway.
  const pdfjsEntry =
    "pdfjsEntry" in dependencies
      ? dependencies.pdfjsEntry
      : resolvePdfjsEntry();
  // `== null` catches both: an explicit null, and a caller that passed
  // the key with an undefined value.
  const pdfjsWorker =
    "pdfjsWorker" in dependencies
      ? dependencies.pdfjsWorker
      : resolvePdfjsWorker();

  if (pdfjsEntry == null) {
    // Degrade to exactly the behaviour before this module existed: the
    // document is findable by name, and nothing pretends to have read it.
    return { ok: false, failure: "parser-unavailable" };
  }

  return new Promise<PdfOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: PdfOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawnChild(
        process.execPath,
        [
          `--max-old-space-size=${maxHeapMb}`,
          "--input-type=module",
          "-e",
          program,
        ],
        {
          cwd: childWorkingDirectory(),
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PDFJS_ENTRY_URL: pathToFileURL(pdfjsEntry).href,
            ...(pdfjsWorker == null
              ? {}
              : { PDFJS_WORKER_URL: pathToFileURL(pdfjsWorker).href }),
            PDF_MAX_PAGES: String(maxPages),
            PDF_MAX_OUTPUT_CHARS: String(maxOutputChars),
          },
        },
      );
    } catch {
      // The runtime would not give us a process at all.
      return resolve({ ok: false, failure: "parser-unavailable" });
    }

    /**
     * The wall clock, held here rather than in the child.
     *
     * A `setTimeout` inside the child cannot fire while the child is inside
     * a synchronous loop, and a synchronous loop is precisely the thing a
     * hostile document induces. `SIGKILL` rather than `SIGTERM` because a
     * handler is not required to honour `SIGTERM` and this one must land.
     */
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    let timedOut = false;

    let stdout = "";
    let stdoutBytes = 0;
    let stdoutOverflowed = false;

    child.stdout?.on("data", (part: Buffer) => {
      stdoutBytes += part.byteLength;
      if (stdoutBytes > maxStdoutBytes) {
        // Our own bound, on the one input to this process we did not write.
        stdoutOverflowed = true;
        child.kill("SIGKILL");
        return;
      }
      stdout += part.toString("utf8");
    });
    // Drained and discarded. pdfjs writes warnings here for ordinary
    // documents, and an unread pipe that fills would block the child.
    child.stderr?.on("data", () => {});

    child.on("error", () => finish({ ok: false, failure: "crashed" }));

    child.on("close", (code, signal) => {
      if (timedOut) return finish({ ok: false, failure: "timeout" });
      if (stdoutOverflowed) return finish({ ok: false, failure: "crashed" });

      /**
       * V8 aborts on heap exhaustion, which arrives as `SIGABRT` — and as
       * a non-zero exit on some platforms. Both are reported as what they
       * are rather than folded into "crashed", because the two have
       * different answers: a bigger heap, or a smaller document.
       */
      if (signal === "SIGABRT" || code === 134) {
        return finish({ ok: false, failure: "out-of-memory" });
      }
      if (signal !== null || code !== 0) {
        return finish({ ok: false, failure: "crashed" });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return finish({ ok: false, failure: "crashed" });
      }

      const result = parsed as Partial<{
        ok: boolean;
        text: string;
        pages: number;
        totalPages: number;
        truncated: boolean;
        failure: PdfFailure;
      }>;

      if (result.ok === true && typeof result.text === "string") {
        const pages = typeof result.pages === "number" ? result.pages : 0;
        return finish({
          ok: true,
          text: result.text,
          pages,
          totalPages:
            typeof result.totalPages === "number" ? result.totalPages : pages,
          truncated: result.truncated === true,
        });
      }
      if (result.ok === false && typeof result.failure === "string") {
        return finish({ ok: false, failure: result.failure });
      }
      return finish({ ok: false, failure: "crashed" });
    });

    child.stdin?.on("error", () => {
      // The child died before it read us. `close` decides the outcome.
    });
    child.stdin?.end(Buffer.from(bytes));
  });
}
