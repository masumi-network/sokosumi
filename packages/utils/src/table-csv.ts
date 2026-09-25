/** Bounded RFC 4180 CSV, including escaped quotes and embedded newlines. */
export function parseTableCsv(text: string): string[][] {
  if (text.length > 5_000_000) throw new Error("CSV exceeds 5 MB");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const input = text.replace(/^\uFEFF/, "");
  function pushField() {
    row.push(field);
    field = "";
    closed = false;
    if (row.length > 100) throw new Error("CSV exceeds 100 columns");
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
    if (rows.length > 10001) throw new Error("CSV exceeds 10,000 rows");
  }
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (field || closed) throw new Error("Unexpected CSV quote");
      quoted = true;
    } else if (char === ",") pushField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      pushRow();
    } else {
      if (closed) throw new Error("Unexpected text after CSV quote");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length || closed) pushRow();
  if (!rows.length || rows[0].some((header) => !header.trim()))
    throw new Error("CSV needs non-empty column headers");
  if (rows.some((row) => row.length !== rows[0].length))
    throw new Error("CSV rows have different column counts");
  return rows;
}

/** Prevent spreadsheet formulas from executing when exported CSV is opened. */
export function encodeTableCsv(rows: unknown[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const raw =
            value == null
              ? ""
              : Array.isArray(value)
                ? value.join("; ")
                : String(value);
          const safe =
            typeof value !== "number" && /^[\s]*[=+@-]/.test(raw)
              ? `'${raw}`
              : raw;
          return `"${safe.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
