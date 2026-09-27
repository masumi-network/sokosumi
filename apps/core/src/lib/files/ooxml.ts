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
 * Extraction runs over reader-supplied bytes, so every loop here is capped:
 *
 * - only **named** parts are read, never every entry in the archive, so a
 *   zip with a million members costs one lookup each for the parts we want;
 *   slide and worksheet parts are enumerated but capped by count;
 * - each part is refused if its *declared uncompressed* size exceeds
 *   `MAX_PART_BYTES`, which stops a zip bomb before it is inflated;
 * - the running total is capped by `MAX_TOTAL_CHARS`, so many small parts
 *   cannot add up to the same thing;
 * - anything that throws resolves to `null`, and the caller records
 *   `UNSUPPORTED` with a reason rather than failing the job.
 */

/** Refuse a single part larger than this once inflated. */
const MAX_PART_BYTES = 8 * 1024 * 1024;
/** Stop once this much text has been collected across all parts. */
const MAX_TOTAL_CHARS = 1_000_000;
/** Slides and worksheets are enumerated; cap how many are read. */
const MAX_ENUMERATED_PARTS = 200;

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
      const semicolon = xml.indexOf(";", index + 1);
      // A bare ampersand, or an entity too long to be real.
      if (semicolon === -1 || semicolon - index > 10) {
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

async function readPart(
  zip: JSZip,
  path: string,
): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;

  // `_data.uncompressedSize` is the size the archive *declares*. Checking it
  // before inflating is what keeps a zip bomb from being expanded at all.
  const declared = (entry as unknown as {
    _data?: { uncompressedSize?: number };
  })._data?.uncompressedSize;
  if (typeof declared === "number" && declared > MAX_PART_BYTES) return null;

  const text = await entry.async("string");
  if (text.length > MAX_PART_BYTES) return null;
  return text;
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
      take(await readPart(zip, path));
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
        if (total >= MAX_TOTAL_CHARS) break;
        take(await readPart(zip, path));
      }
    }
  } catch {
    return null;
  }

  const joined = pieces.join("\n").trim();
  return joined.length > 0 ? joined : null;
}
