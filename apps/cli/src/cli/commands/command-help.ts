import type { CliCommandCatalogEntry } from "./catalog.js";
import type { CommandOutput } from "./command-helpers.js";

type Schema = Record<string, unknown>;

interface OpenApiDocument {
  paths?: Record<string, Record<string, Schema> | undefined>;
  components?: { schemas?: Record<string, Schema> };
}

const MAX_DEPTH = 3;

/**
 * Prints one command's usage. A row that runs one Core operation also prints
 * its query parameters and JSON body fields, read from the target's OpenAPI
 * document: the same schema the MCP tools take.
 */
export async function printCommandHelp({
  row,
  apiUrl,
  stdout,
}: {
  row: CliCommandCatalogEntry;
  apiUrl: string;
  stdout: CommandOutput;
}): Promise<void> {
  const usage = `Usage: sokosumi ${row.command}${row.usage ? ` ${row.usage}` : ""}`;
  if (!row.operation) {
    stdout.write(`${usage}\nRun sokosumi --help for the options it takes.\n`);
    return;
  }
  const lines = [usage, `Core operation: ${row.operation}`, ""];
  const url = `${apiUrl.replace(/\/+$/, "")}/v1/openapi.json`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    lines.push(
      ...describeOperation(
        (await response.json()) as OpenApiDocument,
        row.operation,
      ),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    lines.push(`Could not read the body fields from ${url}: ${reason}`);
  }
  stdout.write(`${lines.join("\n")}\n`);
}

function describeOperation(doc: OpenApiDocument, operation: string): string[] {
  const [method = "", path = ""] = operation.split(" ");
  const definition = doc.paths?.[path]?.[method.toLowerCase()];
  if (!definition) return [`Core's OpenAPI document has no ${operation}.`];
  const lines: string[] = [];
  const query = (
    Array.isArray(definition.parameters) ? definition.parameters : []
  )
    .map((parameter) => resolve(doc, parameter as Schema))
    .filter((parameter) => parameter.in === "query");
  if (query.length) {
    lines.push("Query (--query KEY=VALUE):");
    for (const parameter of query)
      lines.push(
        `  ${field(doc, String(parameter.name), parameter.schema, parameter.required === true, parameter.description)}`,
      );
  }
  const content = resolve(doc, definition.requestBody).content as
    | Record<string, Schema>
    | undefined;
  const body = content?.["application/json"]?.schema;
  if (!body) {
    lines.push("No body.");
    return lines;
  }
  lines.push("Body (--input-json or --input-file):");
  lines.push(...fields(doc, resolve(doc, body), 1));
  return lines;
}

/** One line per field, nested fields indented; a union's shapes split by "or". */
function fields(
  doc: OpenApiDocument,
  schema: Schema,
  depth: number,
  hops = 0,
): string[] {
  // hops bounds a union whose variant refers back to itself.
  if (hops > MAX_DEPTH) return [];
  const indent = "  ".repeat(depth);
  const variants = objectVariants(doc, schema);
  if (variants)
    return variants.flatMap((variant, index) => [
      ...(index ? [`${indent}or`] : []),
      ...fields(doc, variant, depth, hops + 1),
    ]);
  const { properties, required } = merge(doc, schema);
  return Object.entries(properties).flatMap(([name, raw]) => {
    const property = resolve(doc, raw);
    const nested =
      property.type === "array" ? resolve(doc, property.items) : property;
    const deeper =
      depth < MAX_DEPTH && (isObject(nested) || objectVariants(doc, nested))
        ? fields(doc, nested, depth + 1)
        : [];
    return [
      `${indent}${field(doc, name, property, required.has(name))}`,
      ...deeper,
    ];
  });
}

function field(
  doc: OpenApiDocument,
  name: string,
  raw: unknown,
  required: boolean,
  note?: unknown,
): string {
  const schema = resolve(doc, raw);
  const text = note ?? schema.description;
  const description =
    typeof text === "string"
      ? text.replace(/\s+/g, " ").trim().replace(/\.$/, "")
      : "";
  return `${name}  ${typeOf(doc, schema)}${required ? ", required" : ""}${description ? `. ${description}.` : ""}`;
}

function typeOf(doc: OpenApiDocument, raw: unknown): string {
  const schema = resolve(doc, raw);
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => JSON.stringify(value)).join("|");
  if ("const" in schema) return JSON.stringify(schema.const);
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union))
    return [...new Set(union.map((part) => typeOf(doc, part)))].join("|");
  if (isObject(schema)) return "object";
  const types = Array.isArray(schema.type)
    ? schema.type
    : [schema.type ?? "any"];
  return types
    .map((type) =>
      type === "array" ? `array of ${typeOf(doc, schema.items)}` : String(type),
    )
    .join("|");
}

function isObject(schema: Schema): boolean {
  return Boolean(schema.properties) || Array.isArray(schema.allOf);
}

/** The object shapes of a oneOf/anyOf, when at least one of them has fields. */
function objectVariants(
  doc: OpenApiDocument,
  schema: Schema,
): Schema[] | undefined {
  const union = schema.oneOf ?? schema.anyOf;
  if (!Array.isArray(union)) return undefined;
  const variants = union.map((part) => resolve(doc, part));
  return variants.some(isObject) ? variants.filter(isObject) : undefined;
}

/** A schema's fields with its allOf parts folded in, a few levels deep. */
function merge(
  doc: OpenApiDocument,
  schema: Schema,
  hops = 0,
): { properties: Record<string, unknown>; required: Set<string> } {
  const parts =
    Array.isArray(schema.allOf) && hops < MAX_DEPTH
      ? schema.allOf.map((part) => merge(doc, resolve(doc, part), hops + 1))
      : [];
  return {
    properties: Object.assign(
      {},
      ...parts.map((part) => part.properties),
      (schema.properties as Schema | undefined) ?? {},
    ),
    required: new Set([
      ...parts.flatMap((part) => [...part.required]),
      ...(Array.isArray(schema.required) ? (schema.required as string[]) : []),
    ]),
  };
}

function resolve(doc: OpenApiDocument, raw: unknown): Schema {
  let schema = (raw && typeof raw === "object" ? raw : {}) as Schema;
  for (let hops = 0; typeof schema.$ref === "string" && hops < 10; hops += 1) {
    const [, section, name] =
      /^#\/components\/([^/]+)\/(.+)$/.exec(schema.$ref) ?? [];
    const components = doc.components as
      | Record<string, Record<string, Schema> | undefined>
      | undefined;
    schema = (section && name && components?.[section]?.[name]) || {};
  }
  return schema;
}
