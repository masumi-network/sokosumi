import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import { extractPdfText, PDF_MAX_OUTPUT_CHARS, PDF_MAX_PAGES } from "./pdf";
import { buildPdfFixture } from "./pdf-fixture";

/**
 * The parser is exercised for real here: a child process is spawned, a PDF
 * goes over its stdin, and `pdfjs-dist` reads it. Nothing about the parser
 * is mocked, because the thing under test is precisely the behaviour of an
 * interpreter we do not control.
 *
 * What *is* substituted, in the failure tests, is the child program — a
 * stand-in that crashes, hangs or floods on demand. Provoking a real OOM or
 * a real hang out of pdfjs would mean shipping a hostile PDF in the
 * repository and hoping it keeps being hostile after the next upgrade. The
 * parent's handling is the part that has to hold, and this drives every
 * branch of it with a real process really dying.
 */

// A real child process and a real 35 MB parser: generous, and still an
// order of magnitude under what these take.
const TIMEOUT = 30_000;

describe("extracting a PDF text layer", () => {
  it(
    "reads the text, page by page, in document order",
    async () => {
      const bytes = buildPdfFixture({
        pages: ["First page body", "Second page body", "Third page body"],
      });

      const outcome = await extractPdfText(bytes);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.text).toContain("First page body");
      expect(outcome.text).toContain("Second page body");
      expect(outcome.text).toContain("Third page body");
      expect(outcome.text.indexOf("First")).toBeLessThan(
        outcome.text.indexOf("Second"),
      );
      expect(outcome.pages).toBe(3);
      expect(outcome.truncated).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "works without the optional native canvas package",
    async () => {
      /**
       * `pdfjs-dist` declares `@napi-rs/canvas` as an optional dependency and
       * it is excluded in `pnpm-workspace.yaml`, on the grounds that text
       * extraction never rasterizes. This is that claim, checked rather than
       * asserted: the import must genuinely be absent, and extraction must
       * genuinely still work.
       */
      // `require.resolve` rather than `import`: the module genuinely is not
      // installed, so a static import would fail to typecheck — which is the
      // very fact being asserted, and not something to work around by
      // pretending the module exists.
      const resolve = createRequire(import.meta.url).resolve;
      expect(() => resolve("@napi-rs/canvas")).toThrow();

      const outcome = await extractPdfText(
        buildPdfFixture({ pages: ["Canvas is not installed"] }),
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.text).toContain("Canvas is not installed");
    },
    TIMEOUT,
  );
});

describe("the bounds, each one watched firing", () => {
  it(
    "returns a large document intact, well past the old truncation cliff",
    async () => {
      /**
       * The regression test for the branch's fourth silent failure.
       *
       * The child wrote its whole result with one unflushed
       * `process.stdout.write` and then called `process.exit(0)`. Writes
       * to a pipe are asynchronous on POSIX and `process.exit` discards
       * the pending remainder, so everything past roughly 143 KB of
       * extracted text arrived as a prefix, failed `JSON.parse` in the
       * parent, and was recorded as `crashed` — "The PDF reader stopped
       * unexpectedly on this file", which blamed the document for a bug
       * in the plumbing. Measured on this machine before the fix: 100,000
       * characters fine, 140,000 crashed, every time.
       *
       * It also meant two of the five advertised bounds could never fire
       * in production, because the process died two orders of magnitude
       * before either of them.
       *
       * The result now leaves on its own file descriptor, written with
       * `fs.writeSync`, which returns only once the bytes are handed over.
       */
      const asked = 200_000;
      const outcome = await extractPdfText(
        buildPdfFixture({ pages: ["Q".repeat(asked)] }),
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.text.replace(/\s/gu, "")).toHaveLength(asked);
      expect(outcome.truncated).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "does not corrupt multi-byte characters at a chunk boundary",
    async () => {
      /**
       * The parent decoded each `data` event with `part.toString("utf8")`
       * as it arrived, so a multi-byte sequence straddling a 64 KiB chunk
       * boundary became replacement characters on both sides. Whether a
       * boundary lands mid-character depends on where the JSON envelope
       * pushed it, so the corruption was intermittent — worse than
       * consistent. It reached the stored chunk text, its digest, the
       * tsvector and any excerpt sent to the model.
       *
       * Driven through a stand-in child rather than a fixture, because
       * the finding is in the parent's decoding and because the fixture's
       * Type1 Helvetica font has no CJK glyphs — a PDF carrying this text
       * cannot be built by `buildPdfFixture` at all.
       */
      const text = "企".repeat(60_000);
      const outcome = await extractPdfText(new Uint8Array([1]), {
        childProgram: [
          'import fsSync from "node:fs";',
          `const payload = Buffer.from(JSON.stringify({ ok: true, text: "企".repeat(60000), pages: 1, totalPages: 1, truncated: false }), "utf8");`,
          "let written = 0;",
          "while (written < payload.length) {",
          "  try { written += fsSync.writeSync(3, payload, written); }",
          "  catch (e) { if (e && (e.code === 'EAGAIN' || e.code === 'EINTR')) continue; throw e; }",
          "}",
          "process.exit(0);",
        ].join("\n"),
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // 180,000 bytes of UTF-8, so many 64 KiB boundaries were crossed.
      expect(outcome.text).toHaveLength(60_000);
      expect(outcome.text).not.toContain("\uFFFD");
      expect(outcome.text).toBe(text);
    },
    TIMEOUT,
  );

  it(
    "still answers a small document promptly",
    async () => {
      /**
       * The other half of the bargain. Removing `process.exit` without
       * thinking would fix the truncation by letting the child linger
       * until the 20 second wall clock on every ordinary document, which
       * trades a wrong answer for a slow one.
       */
      const started = Date.now();
      const outcome = await extractPdfText(
        buildPdfFixture({ pages: ["A small ordinary document."] }),
      );
      const elapsed = Date.now() - started;

      expect(outcome.ok).toBe(true);
      // Generous against a cold machine, and still two orders of
      // magnitude below the timeout it must not be waiting for.
      expect(elapsed).toBeLessThan(5_000);
    },
    TIMEOUT,
  );

  it(
    "stops at the page cap, mid-document",
    async () => {
      // Four pages, a cap of two. The third and fourth must never be read —
      // not read and discarded, which is what a post-check would do.
      const bytes = buildPdfFixture({
        pages: ["AAAA one", "BBBB two", "CCCC three", "DDDD four"],
      });

      const outcome = await extractPdfText(bytes, { maxPages: 2 });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.pages).toBe(2);
      expect(outcome.truncated).toBe(true);
      expect(outcome.text).toContain("AAAA one");
      expect(outcome.text).toContain("BBBB two");
      expect(outcome.text).not.toContain("CCCC three");
      expect(outcome.text).not.toContain("DDDD four");
    },
    TIMEOUT,
  );

  it(
    "stops at the output character cap, mid-document",
    async () => {
      // No spaces: the fixture preserves non-whitespace exactly, so the
      // arithmetic below is about the cap rather than about PDF layout.
      const page = "x".repeat(400);
      const bytes = buildPdfFixture({ pages: [page, page, page, page, page] });

      const outcome = await extractPdfText(bytes, { maxOutputChars: 500 });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.truncated).toBe(true);
      expect(outcome.text.length).toBe(500);
      // And it stopped early rather than reading all five and slicing: the
      // difference between a bound and a post-check.
      expect(outcome.pages).toBeLessThan(5);
    },
    TIMEOUT,
  );

  it(
    "kills a child that will not finish, and says so",
    async () => {
      const started = Date.now();
      const outcome = await extractPdfText(new Uint8Array([1, 2, 3]), {
        timeoutMs: 700,
        // A child that ignores its input and never exits. A timer inside the
        // child could not save us from this, which is why the parent holds
        // the clock.
        childProgram: "while (true) {}",
      });
      const elapsed = Date.now() - started;

      expect(outcome).toEqual({ ok: false, failure: "timeout" });
      // The bound is a bound: it returned near the deadline, not eventually.
      expect(elapsed).toBeLessThan(10_000);
    },
    TIMEOUT,
  );

  it(
    "gives up on a child that floods the result channel",
    async () => {
      /**
       * The child here is deliberately **well-behaved about backpressure**,
       * and that is the whole point of the test.
       *
       * The first version pumped 64 MB a tick and ignored `write`'s return
       * value. It died on its own in under a second, so the parent reported
       * `crashed` whether or not the bound existed — the test passed with the
       * guard removed, which made it worthless. A child that waits for
       * `drain` survives indefinitely, so the only thing that can end this is
       * the parent's own bound.
       *
       * With the bound removed the parent accumulates until `timeoutMs`, and
       * the outcome becomes `timeout` instead: a different answer, which is
       * what makes the assertion bite.
       */
      const started = Date.now();
      const outcome = await extractPdfText(new Uint8Array([1]), {
        timeoutMs: 8_000,
        maxResultBytes: 512 * 1024,
        childProgram: `
import fsSync from "node:fs";
        const chunk = Buffer.alloc(64 * 1024, 0x79);
        // Floods the *result* channel, which is the one the parent reads
        // and therefore the one its byte bound has to defend.
        for (;;) {
          try { fsSync.writeSync(3, chunk); } catch { /* EAGAIN: keep going */ }
        }
      `,
      });
      const elapsed = Date.now() - started;

      expect(outcome).toEqual({ ok: false, failure: "crashed" });
      // Stopped by the byte bound, well before the clock could have done it.
      expect(elapsed).toBeLessThan(6_000);
    },
    TIMEOUT,
  );

  it(
    "sends the production caps when none are overridden",
    async () => {
      /**
       * The firing tests above lower the caps to stay fast. This is the other
       * half of that bargain: the values actually handed to the child, with
       * no overrides, are the exported constants. Without it, the caps could
       * be tested at 2 and shipped at zero.
       */
      const outcome = await extractPdfText(
        buildPdfFixture({ pages: ["irrelevant"] }),
        {
          childProgram: `
import fsSync from "node:fs";
          fsSync.writeSync(3, JSON.stringify({
            ok: true,
            text: process.env.PDF_MAX_PAGES + "/" + process.env.PDF_MAX_OUTPUT_CHARS,
            pages: 1,
            truncated: false,
          }));
        `,
        },
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.text).toBe(`${PDF_MAX_PAGES}/${PDF_MAX_OUTPUT_CHARS}`);
    },
    TIMEOUT,
  );
});

describe("every failure lands on a named outcome, never a throw", () => {
  it(
    "reports a parser that is not installed, without spawning anything",
    async () => {
      /**
       * The deployment case, and the one most likely to be real: the
       * function bundle shipped without `pdfjs-dist`. The parent resolves
       * the entry point before it spawns, so this is answered without a
       * process at all, and the answer is the behaviour from before this
       * module existed rather than a 500.
       */
      let spawned = 0;
      const outcome = await extractPdfText(new Uint8Array([1]), {
        pdfjsEntry: null,
        spawnChild: (() => {
          spawned += 1;
          throw new Error("must not spawn");
        }) as never,
      });

      expect(outcome).toEqual({ ok: false, failure: "parser-unavailable" });
      expect(spawned).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "actually loads the worker module, and fails named when it cannot",
    async () => {
      /**
       * Proof that the worker file is on this path, not an assumption.
       *
       * In Node pdfjs disables the real worker and its fake worker does
       * `await import(GlobalWorkerOptions.workerSrc)`. If that import were
       * *not* happening, pointing `workerSrc` at a file that does not
       * exist would change nothing and extraction would still succeed.
       * It does not succeed — which is what proves the worker module has
       * to be in the deployed bundle alongside `pdf.mjs`.
       */
      const outcome = await extractPdfText(
        buildPdfFixture({ pages: ["Worker is required"] }),
        { pdfjsWorker: "/nonexistent/pdfjs/pdf.worker.mjs" },
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure).toBe("unreadable");
    },
    TIMEOUT,
  );

  it(
    "reports a parser the child cannot import",
    async () => {
      // Resolution succeeded but the file is unusable by the time the
      // child reaches it. Distinct from the case above, which never
      // spawns.
      const outcome = await extractPdfText(new Uint8Array([1]), {
        pdfjsEntry: "/nonexistent/pdfjs/entry.mjs",
      });

      expect(outcome).toEqual({ ok: false, failure: "parser-unavailable" });
    },
    TIMEOUT,
  );

  it(
    "reports a child that exits non-zero",
    async () => {
      const outcome = await extractPdfText(new Uint8Array([1]), {
        childProgram: "process.exit(3);",
      });

      expect(outcome).toEqual({ ok: false, failure: "crashed" });
    },
    TIMEOUT,
  );

  it(
    "reports a child killed by heap exhaustion as out of memory",
    async () => {
      const outcome = await extractPdfText(new Uint8Array([1]), {
        // `process.abort()` raises SIGABRT, which is what V8 does when the
        // old space cannot grow. Distinguished from a plain crash because the
        // two have different answers.
        childProgram: "process.abort();",
      });

      expect(outcome).toEqual({ ok: false, failure: "out-of-memory" });
    },
    TIMEOUT,
  );

  it(
    "reports a child that writes something that is not a result",
    async () => {
      /**
       * The child must actually write and exit cleanly, or this asserts
       * the wrong thing. Without the import `fsSync` is undefined, the
       * child throws, and the parent reports `crashed` because the child
       * died — which is the expected value, so the test would pass while
       * testing nothing about unparseable output.
       */
      const outcome = await extractPdfText(new Uint8Array([1]), {
        childProgram: [
          'import fsSync from "node:fs";',
          'fsSync.writeSync(3, "not json at all");',
          "process.exit(0);",
        ].join("\n"),
      });

      expect(outcome).toEqual({ ok: false, failure: "crashed" });
    },
    TIMEOUT,
  );

  it(
    "reports bytes that are not a PDF at all",
    async () => {
      const outcome = await extractPdfText(
        new Uint8Array(Buffer.from("this is a text file, not a PDF", "utf8")),
      );

      expect(outcome).toEqual({ ok: false, failure: "unreadable" });
    },
    TIMEOUT,
  );

  it(
    "reports a PDF whose pages carry no text layer",
    async () => {
      // A structurally valid PDF with an empty content stream: the shape a
      // scan has. No OCR is attempted and none is implied.
      const outcome = await extractPdfText(
        buildPdfFixture({ pages: ["", "", ""] }),
      );

      expect(outcome).toEqual({ ok: false, failure: "no-text-layer" });
    },
    TIMEOUT,
  );

  it(
    "returns a value rather than throwing, for every one of them",
    async () => {
      // The caller is an indexing job whose contract is that it completes. A
      // throw would retry forever against a document that will never parse.
      const cases: Array<Promise<unknown>> = [
        extractPdfText(new Uint8Array([]), {
          childProgram: "process.exit(1);",
        }),
        extractPdfText(new Uint8Array([0xff, 0xd8])),
        extractPdfText(new Uint8Array([1]), {
          childProgram: "process.abort();",
        }),
      ];

      for (const pending of cases) {
        await expect(pending).resolves.toBeTruthy();
      }
    },
    TIMEOUT,
  );
});
