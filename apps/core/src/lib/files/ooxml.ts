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
 * archive supplies**:
 *
 * - only **named** parts are read, never every entry in the archive, so a
 *   zip with a million members costs one lookup each for the parts we want;
 *   slide and worksheet parts are enumerated but capped by count;
 * - each part is inflated through a **streaming budget** and abandoned the
 *   moment the bytes actually received pass `MAX_PART_BYTES`. An earlier
 *   version checked the *declared* uncompressed size from the ZIP central
 *   directory instead. That number belongs to the attacker: a part declaring
 *   100 bytes and inflating to 700 MB passed the check, and the full inflate
 *   that followed was a V8 fatal OOM — which is not a throw, so it took the
 *   whole process and its co-tenant requests with it;
 * - `MAX_DOCUMENT_BYTES` bounds the *sum* across parts, because 200 slides
 *   each just under the part cap is a gigabyte and a half for one upload;
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

/**
 * Text from an OOXML document, or `null` when it cannot be read.
 *
 * `null` is not an error path for the caller to throw on — it means "record
 * this honestly as unsupported". An encrypted, corrupt or unexpected archive
 * lands here.
 */
export async function extractOoxmlText(
  bytes: Uint8Array,
  kind: OoxmlKind,
): Promise<string | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return null;
  }

  const pieces: string[] = [];
  const budget: InflationBudget = { remaining: MAX_DOCUMENT_BYTES };
  let total = 0;

  const take = (text: string | null) => {
    if (!text || total >= MAX_TOTAL_CHARS) return;
    const stripped = stripXmlTags(text);
    const room = MAX_TOTAL_CHARS - total;
    const slice = stripped.slice(0, room);
    if (slice.trim().length === 0) return;
    pieces.push(slice);
    total += slice.length;
  };

  try {
    for (const path of fixedParts(kind)) {
      take(await readPart(zip, path, budget));
    }

    const prefix = enumeratedPrefix(kind);
    if (prefix) {
      // Sorted so slide 2 follows slide 1 rather than slide 10.
      const paths = Object.keys(zip.files)
        .filter((path) => path.startsWith(prefix) && path.endsWith(".xml"))
        .sort((left, right) => {
          const number = (value: string) =>
            Number.parseInt(value.replace(/\D+/g, ""), 10) || 0;
          return number(left) - number(right);
        })
        .slice(0, MAX_ENUMERATED_PARTS);

      for (const path of paths) {
        if (total >= MAX_TOTAL_CHARS || budget.remaining <= 0) break;
        take(await readPart(zip, path, budget));
      }
    }
  } catch {
    return null;
  }

  const joined = pieces.join("\n").trim();
  return joined.length > 0 ? joined : null;
}
