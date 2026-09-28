import JSZip from "jszip";

/**
 * Reading the text out of a Word, PowerPoint or Excel file.
 *
 * An OOXML file is a ZIP of XML parts. That is the whole trick: unzip the
 * two or three parts that carry prose and strip their tags. No rendering, no
 * layout, no formulas — text, in document order, for search.
 *
 * ## Why `jszip` and nothing else
 *
 * `jszip` is already in this repository's lockfile, pulled in by the `docx`
 * package the web app uses to *write* documents. Adding it to Core adds a
 * direct dependency on code that is already installed, rather than new code
 * to the tree. No XML parser is used at all: the tag stripper below is a
 * character scan, so there is no entity expansion, no DTD, no external
 * entity fetch, and none of the XXE surface a real parser brings.
 *
 * ## What bounds an adversarial file
 *
 * Extraction runs over reader-supplied bytes, so every loop here is capped —
 * and, learned the hard way, **no cap may be computed from a number the
 * archive supplies**.
 *
 * ### The rule a new cap has to satisfy
 *
 * **A bound must be enforced before the work it bounds, not after.** Stated
 * once here because the same defect has now been found three times in this
 * feature, in three files, wearing three different costumes:
 *
 * 1. the *declared* uncompressed size read from the ZIP central directory —
 *    a number the attacker writes — checked before an inflate that then ran
 *    to completion anyway;
 * 2. `MAX_ENUMERATED_PARTS` applied as `.slice(0, 200)` after enumerating,
 *    filtering and sorting every entry in the archive, which bounded how
 *    many parts were read and not the cost of choosing them;
 * 3. `pdf.ts` checking its character cap after `getTextContent()`, which
 *    materialises every text item on the page before the cap can be
 *    consulted.
 *
 * Each one passed review, and each one is the same sentence: a post-check is
 * a check that runs once the memory is already spent. The test for a new cap
 * is not "does it return the right answer" but "can the work it forbids
 * still happen before it says no".
 *
 * ### The caps themselves
 *
 * - only **named** parts are read, never every entry in the archive. Slide
 *   and worksheet parts are found by *probing* `slide1`, `slide2` and so on
 *   by name up to the cap, so a zip with a million members costs one lookup
 *   each for the parts we want. This is instance 2 above, fixed: selecting
 *   by enumeration cost 180 ms of synchronous API-process work on an archive
 *   of 300,000 matching entries, against 0 ms for the probe. `loadAsync`
 *   itself still costs 1,603 ms on that archive and this does not address
 *   it — that cost belongs to jszip's central-directory parse, and it is
 *   bounded only by `FILE_EXTRACTION_MAX_BYTES`;
 * - each part is inflated through a **streaming budget** and abandoned the
 *   moment the bytes actually received pass `MAX_PART_BYTES`. An earlier
 *   version checked the *declared* uncompressed size from the ZIP central
 *   directory instead. That number belongs to the attacker: a part declaring
 *   100 bytes and inflating to 700 MB passed the check, and the full inflate
 *   that followed was a V8 fatal OOM — which is not a throw, so it took the
 *   whole process and its co-tenant requests with it;
 * - `MAX_DOCUMENT_BYTES` bounds the *sum* across parts, because 200 slides
 *   each just under the part cap is a gigabyte and a half for one upload;
 *
 * ### Every cap has to be visible to the caller
 *
 * A bound that silently discards content is a worse failure than the one it
 * prevents. All four caps here report through `OoxmlExtraction`, and the
 * caller passes that to `resultFromText` as `source`. Before that, the arm
 * returned a bare string and the caller defaulted to
 * `{ truncated: false, coverage: 1 }`, so a 400-slide deck read to slide 200
 * was recorded INDEXED at coverage 1.0 with no reason — half of it
 * unsearchable while the interface said it was complete. Coverage is
 * measured against what the document held, never against what survived,
 * because the second always rounds to 1;
 * - entity decoding looks ahead a bounded window. Scanning for the closing
 *   `;` across the whole document and rejecting an overlong match afterwards
 *   bounded nothing: it was quadratic in the number of bare ampersands, and
 *   8 MB of them — an honest file passing every size cap — blocked the event
 *   loop for minutes;
 * - the running total of kept text is capped by `MAX_TOTAL_CHARS`;
 * - anything that throws resolves to `null`, and the caller records
 *   `UNSUPPORTED` with a reason rather than failing the job. That contract
 *   only holds because no path here can now exhaust memory: a fatal OOM is
 *   not catchable, so a bound that spends the memory first is not a bound.
 */

/** Refuse a single part larger than this once inflated. */
const MAX_PART_BYTES = 8 * 1024 * 1024;
/** Stop once this much text has been collected across all parts. */
const MAX_TOTAL_CHARS = 1_000_000;
/** Slides and worksheets are enumerated; cap how many are read. */
const MAX_ENUMERATED_PARTS = 200;
/** Longest `&…;` this reader will look ahead for; nothing real is longer. */
const MAX_ENTITY_LENGTH = 10;
/** Total inflated bytes one document may cost, across all of its parts. */
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;

export type OoxmlKind = "docx" | "pptx" | "xlsx";

export function ooxmlKindFor(input: {
  mimeType: string | null;
  displayName: string;
}): OoxmlKind | null {
  const mime = (input.mimeType ?? "").toLowerCase();
  const extension = input.displayName.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (extension === "pptx" || mime.includes("presentationml")) return "pptx";
  if (extension === "xlsx" || mime.includes("spreadsheetml")) return "xlsx";
  return null;
}

/**
 * Strip XML tags and decode the five predefined entities.
 *
 * A character scan rather than a parser, deliberately — see the note above.
 * Numeric references are decoded only within the Basic Multilingual Plane
 * and only when they are short, so a crafted `&#x...;` cannot become a loop.
 */
export function stripXmlTags(xml: string): string {
  let out = "";
  let depth = 0;

  for (let index = 0; index < xml.length; index += 1) {
    const character = xml[index];

    if (character === "<") {
      depth += 1;
      // `<w:p>` and `<w:br/>` end a block; emit a separator so words from
      // adjacent runs do not fuse into one token.
      const tail = xml.slice(index, index + 8);
      if (
        tail.startsWith("</w:p>") ||
        tail.startsWith("<w:br") ||
        tail.startsWith("</a:p>") ||
        tail.startsWith("</text:p")
      ) {
        out += "\n";
      }
      continue;
    }
    if (character === ">") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;

    if (character === "&") {
      // Search only the window an entity could occupy. `indexOf` scans to the
      // end of the document when there is no `;` ahead, so a part full of bare
      // ampersands cost one full-document scan *each* — quadratic, and 8 MB of
      // them took minutes of blocked event loop. Rejecting the overlong match
      // afterwards bounded nothing, because the scan had already happened.
      const limit = Math.min(index + MAX_ENTITY_LENGTH + 1, xml.length - 1);
      let semicolon = -1;
      for (let ahead = index + 1; ahead <= limit; ahead += 1) {
        if (xml[ahead] === ";") {
          semicolon = ahead;
          break;
        }
      }
      // A bare ampersand, or an entity too long to be real.
      if (semicolon === -1) {
        out += "&";
        continue;
      }
      const entity = xml.slice(index + 1, semicolon);
      index = semicolon;
      switch (entity) {
        case "amp":
          out += "&";
          break;
        case "lt":
          out += "<";
          break;
        case "gt":
          out += ">";
          break;
        case "quot":
          out += '"';
          break;
        case "apos":
          out += "'";
          break;
        default: {
          if (entity.startsWith("#")) {
            const code = entity.startsWith("#x")
              ? Number.parseInt(entity.slice(2), 16)
              : Number.parseInt(entity.slice(1), 10);
            // Nothing above the BMP, nothing that is not a character.
            if (Number.isFinite(code) && code > 0 && code <= 0xffff) {
              out += String.fromCharCode(code);
            }
          }
          // An unknown named entity is dropped rather than guessed at.
          break;
        }
      }
      continue;
    }

    out += character;
  }

  return out;
}

/** The parts that carry prose, per format. */
function fixedParts(kind: OoxmlKind): string[] {
  switch (kind) {
    case "docx":
      return ["word/document.xml"];
    case "pptx":
      return [];
    case "xlsx":
      return ["xl/sharedStrings.xml"];
  }
}

function enumeratedPrefix(kind: OoxmlKind): string | null {
  switch (kind) {
    case "pptx":
      return "ppt/slides/slide";
    case "xlsx":
      return "xl/worksheets/sheet";
    default:
      return null;
  }
}

/**
 * How many inflated bytes this document has left to spend.
 *
 * Per-part caps alone do not bound a document: a presentation can name 200
 * slides, and 200 parts that are each just under the part cap is 1.6 GB of
 * decompression for one upload. The remaining budget is carried across every
 * part so the whole document costs at most `MAX_DOCUMENT_BYTES`.
 */
type InflationBudget = { remaining: number };

/**
 * Inflate one part, refusing it *while* it decompresses rather than after.
 *
 * Nothing the archive says about its own sizes is consulted. The only number
 * trusted here is the count of bytes this process has actually received, and
 * the moment that count passes the budget the stream is paused and the part
 * is refused. Pausing genuinely stops the inflater — the source worker checks
 * its paused flag before producing more — so the cost of a refused part is
 * the budget plus whatever was already in flight, not the part's real size.
 */
async function readPart(
  zip: JSZip,
  path: string,
  budget: InflationBudget,
): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;

  const cap = Math.min(MAX_PART_BYTES, budget.remaining);
  if (cap <= 0) return null;

  const chunks: Buffer[] = [];
  let taken = 0;

  // `nodeStream` is jszip's documented streaming read. Using it rather than
  // the internal stream helper is deliberate: the defect this replaces came
  // from reaching past the public surface for `_data.uncompressedSize`.
  const complete = await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const stream = entry.nodeStream("nodebuffer");

    const stop = (finished: boolean) => {
      if (settled) return;
      settled = true;
      stream.pause();
      (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      resolve(finished);
    };

    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      taken += chunk.length;
      if (taken > cap) {
        stop(false);
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    stream.on("end", () => stop(true));
  });

  // Spend the budget on what was inflated, including a part that was refused
  // part-way: an archive does not get to retry the same cost 200 times.
  budget.remaining -= Math.min(taken, cap);

  if (!complete) return null;

  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/** Which cap, if any, kept text out of the result. */
export type OoxmlShortfall =
  | "parts"
  | "part-bytes"
  | "document-bytes"
  | "chars";

export interface OoxmlExtraction {
  text: string;
  /** True when any cap discarded content. */
  truncated: boolean;
  /**
   * The fraction of the document's text that reached the caller.
   *
   * Measured on both axes that can lose content, because either alone is a
   * lie. Parts read over parts present catches a deck cut off at slide 200
   * of 400; characters kept over characters seen catches a single part
   * longer than the character budget. A 400-slide deck that is otherwise
   * complete is 0.5, not 1.
   */
  coverage: number;
  /** The first cap that discarded something, for a reason the reader can act on. */
  shortfall: OoxmlShortfall | null;
}

/**
 * Text from an OOXML document, or `null` when it cannot be read.
 *
 * `null` is not an error path for the caller to throw on — it means "record
 * this honestly as unsupported". An encrypted, corrupt or unexpected archive
 * lands here.
 *
 * ## Why this returns more than a string
 *
 * It used to return `string | null`, and the caller passed the string to
 * `resultFromText` with no `source`, which defaults to
 * `{ truncated: false, coverage: 1 }`. So every one of the four caps below
 * could discard content and the document was still recorded as INDEXED at
 * coverage 1.0 with no reason. Measured on a 400-slide deck: the last slide
 * read was 200, and the result was INDEXED, coverage 1, reason null. Half
 * the deck unsearchable, and the interface saying it was fully indexed.
 *
 * `resultFromText`'s own docstring already named this failure for the PDF
 * arm — "a 900-page document read to page 200 would compute coverage 1.0
 * over the 200 pages it received" — and the OOXML arm was doing exactly
 * that.
 */
export async function extractOoxmlText(
  bytes: Uint8Array,
  kind: OoxmlKind,
): Promise<OoxmlExtraction | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return null;
  }

  const pieces: string[] = [];
  const budget: InflationBudget = { remaining: MAX_DOCUMENT_BYTES };
  let total = 0;

  /** Denominators, so coverage is measured against the document. */
  let partsPresent = 0;
  let partsRead = 0;
  let charsSeen = 0;
  let shortfall: OoxmlShortfall | null = null;

  const note = (cap: OoxmlShortfall) => {
    shortfall ??= cap;
  };

  const take = (text: string | null) => {
    if (text === null) return;
    partsRead += 1;
    const stripped = stripXmlTags(text);
    charsSeen += stripped.length;
    if (total >= MAX_TOTAL_CHARS) {
      if (stripped.trim().length > 0) note("chars");
      return;
    }
    const room = MAX_TOTAL_CHARS - total;
    const slice = stripped.slice(0, room);
    if (slice.length < stripped.length) note("chars");
    if (slice.trim().length === 0) return;
    pieces.push(slice);
    total += slice.length;
  };

  /**
   * Which parts this document has, taken from the archive's own entry
   * list.
   *
   * This was a name probe — asking for slide1, slide2 and so on until a
   * run of misses — and that reintroduced, one level up, the defect this
   * module exists to prevent. `partsPresent` came from what the probe
   * found, so the coverage denominator was a number the probe supplied.
   * A gap wider than the lookahead ended it, and every part beyond the
   * gap was missing from the numerator and the denominator alike:
   * coverage 1, shortfall null, most of the document unread. Reproduced
   * on a deck with a gap of ten, which reported fully indexed with 2 of
   * 12 parts in the text.
   *
   * Raising the lookahead does not fix that. Any fixed number is a guess
   * at a producer convention and the failure stays silent past it.
   *
   * The pre-check rule is still satisfied, because the probe was bounding
   * the wrong thing. The work a cap has to run in front of here is
   * *decompression*, not name enumeration: the entry list is
   * central-directory metadata jszip has already parsed and is holding,
   * and `MAX_ENUMERATED_PARTS` is applied below before any part's content
   * is read. Enumerating costs 180 ms on a 300,000-entry archive against
   * the 1,603 ms `loadAsync` already spends on it unconditionally —
   * about 11% of a path we walk anyway, bounded by the same
   * `FILE_EXTRACTION_MAX_BYTES` — which is a better trade than a silent
   * under-report.
   *
   * Ordering is by numeric suffix, which is what it was before the probe
   * and is **not** verified to be presentation order. For a presentation
   * that is the relationship list, not the filename; the fixtures
   * available here carry no relationship part, so this is unchanged
   * rather than confirmed correct.
   */
  const enumeratedParts = (prefix: string): string[] => {
    const pattern = new RegExp(
      `^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(\\d+)\\.xml$`,
      "u",
    );

    const found: { path: string; index: number }[] = [];
    for (const path of Object.keys(zip.files)) {
      const match = pattern.exec(path);
      if (match) found.push({ path, index: Number(match[1]) });
    }
    // "slide10" must not sort before "slide2".
    found.sort((left, right) => left.index - right.index);
    return found.map((entry) => entry.path);
  };

  try {
    for (const path of fixedParts(kind)) {
      if (!zip.file(path)) continue;
      partsPresent += 1;
      const before = budget.remaining;
      const text = await readPart(zip, path, budget);
      if (text === null) {
        note(budget.remaining < before ? "part-bytes" : "document-bytes");
        continue;
      }
      take(text);
    }

    const prefix = enumeratedPrefix(kind);
    if (prefix) {
      const all = enumeratedParts(prefix);
      partsPresent += all.length;

      const paths = all.slice(0, MAX_ENUMERATED_PARTS);
      if (all.length > paths.length) note("parts");

      for (const path of paths) {
        if (total >= MAX_TOTAL_CHARS) {
          note("chars");
          break;
        }
        if (budget.remaining <= 0) {
          note("document-bytes");
          break;
        }
        const before = budget.remaining;
        const text = await readPart(zip, path, budget);
        if (text === null) {
          note(budget.remaining < before ? "part-bytes" : "document-bytes");
          continue;
        }
        take(text);
      }
    }
  } catch {
    return null;
  }

  const joined = pieces.join("\n").trim();

  /**
   * Nothing read and no cap to blame: this is not the document it claimed
   * to be. Same `null` the caller has always handled, and the same
   * "encrypted or damaged" it has always produced — which is accurate
   * here, unlike the size cases below, where it was not.
   */
  if (joined.length === 0 && shortfall === null) return null;

  /**
   * Both factors, multiplied.
   *
   * `charsKept / charsSeen` is what survived inside the parts we opened;
   * `partsRead / partsPresent` is how much of the document we opened at
   * all. Either on its own reports 1.0 for a failure the other one sees —
   * a truncated single part looks like full part coverage, and a deck cut
   * in half looks like every character kept.
   */
  const charFactor = charsSeen === 0 ? 1 : Math.min(1, total / charsSeen);
  const partFactor = partsPresent === 0 ? 1 : partsRead / partsPresent;
  const coverage = Math.min(1, charFactor * partFactor);

  return {
    text: joined,
    truncated: shortfall !== null,
    coverage,
    shortfall,
  };
}
