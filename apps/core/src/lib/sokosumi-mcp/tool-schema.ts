import { getV1OpenApiDocument } from "@/routes/v1/openapi-document";

import { MCP_TOOLS, type McpTool } from "./tools";

type JsonSchema = Record<string, unknown>;

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

interface OpenApiOperation {
  parameters?: (OpenApiParameter | { $ref: string })[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: JsonSchema }>;
  };
}

export interface OpenApiDocument {
  paths?: Record<string, Record<string, unknown> | undefined>;
  components?: Record<string, Record<string, unknown> | undefined>;
}

/** How a tool's arguments map onto its operation's request. */
export interface ToolInput {
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  hasBody: boolean;
  inputSchema: JsonSchema & { type: "object" };
}

/**
 * Core reads `X-Organization-Slug` on every authenticated route
 * (`organizationContextMiddleware`), documented or not, so every tool takes it.
 */
const WORKSPACE_ARGUMENT: JsonSchema = {
  type: "string",
  description:
    "Organization workspace slug from workspaces_list. Omit for the personal workspace.",
};

const COMPONENT_REF = /^#\/components\/schemas\/(.+)$/;

/**
 * The input schema of the tool for `operation` (`METHOD /path`): its path and
 * query parameters by name, `workspace` for `X-Organization-Slug`, and its JSON
 * body as `body`. Other headers (coworker context, client build) are not tool
 * arguments. Schema `$ref`s move into `$defs`, so the schema stands alone.
 */
export function deriveToolInput(
  doc: OpenApiDocument,
  operation: string,
): ToolInput {
  const [method = "", path = ""] = operation.split(" ");
  const definition = doc.paths?.[path]?.[method.toLowerCase()] as
    | OpenApiOperation
    | undefined;
  if (!definition) {
    throw new Error(`Core's OpenAPI document has no ${operation}.`);
  }

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const pathParams: string[] = [];
  const queryParams: string[] = [];
  const add = (name: string, schema: JsonSchema, isRequired: boolean) => {
    if (name in properties) {
      throw new Error(`${operation}: two arguments are named "${name}".`);
    }
    properties[name] = schema;
    if (isRequired) required.push(name);
  };

  add("workspace", WORKSPACE_ARGUMENT, false);
  for (const entry of definition.parameters ?? []) {
    const parameter = resolveParameter(doc, entry);
    if (parameter.in !== "path" && parameter.in !== "query") continue;
    (parameter.in === "path" ? pathParams : queryParams).push(parameter.name);
    add(
      parameter.name,
      {
        ...parameter.schema,
        ...(parameter.description
          ? { description: parameter.description }
          : {}),
      },
      parameter.in === "path" || parameter.required === true,
    );
  }

  const bodySchema =
    definition.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema) {
    add("body", bodySchema, definition.requestBody?.required === true);
  }

  const defs = collectDefs(doc, properties);
  return {
    method,
    path,
    pathParams,
    queryParams,
    hasBody: Boolean(bodySchema),
    inputSchema: {
      type: "object",
      properties: rewriteRefs(properties) as Record<string, JsonSchema>,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
      ...(Object.keys(defs).length > 0 ? { $defs: rewriteRefs(defs) } : {}),
    },
  };
}

function resolveParameter(
  doc: OpenApiDocument,
  entry: OpenApiParameter | { $ref: string },
): OpenApiParameter {
  if (!("$ref" in entry)) return entry;
  const name = entry.$ref.replace("#/components/parameters/", "");
  const parameter = doc.components?.parameters?.[name];
  if (!parameter) throw new Error(`Unresolved parameter ${entry.$ref}.`);
  return parameter as OpenApiParameter;
}

/** Every component schema `value` reaches, directly or through another. */
function collectDefs(
  doc: OpenApiDocument,
  value: unknown,
  defs: Record<string, unknown> = {},
): Record<string, unknown> {
  if (Array.isArray(value)) {
    for (const item of value) collectDefs(doc, item, defs);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const name =
        key === "$ref" && typeof child === "string"
          ? COMPONENT_REF.exec(child)?.[1]
          : undefined;
      if (name === undefined) {
        collectDefs(doc, child, defs);
      } else if (!(name in defs)) {
        const schema = doc.components?.schemas?.[name];
        if (!schema) throw new Error(`Unresolved schema ${child}.`);
        defs[name] = schema;
        collectDefs(doc, schema, defs);
      }
    }
  }
  return defs;
}

function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "$ref" && typeof child === "string"
        ? child.replace(COMPONENT_REF, "#/$defs/$1")
        : rewriteRefs(child),
    ]),
  );
}

/** A registry row with the input derived from its operation. */
export interface DerivedTool extends McpTool {
  input: ToolInput;
}

let tools: ReadonlyMap<string, DerivedTool> | undefined;

/**
 * Every tool in `MCP_TOOLS` by name, with its input derived once per process
 * on the first MCP request. Most of the cost is building the OpenAPI document.
 */
export function getTools(): ReadonlyMap<string, DerivedTool> {
  if (!tools) {
    const doc = getV1OpenApiDocument() as OpenApiDocument;
    tools = new Map(
      MCP_TOOLS.map((tool) => [
        tool.name,
        { ...tool, input: deriveToolInput(doc, tool.operation) },
      ]),
    );
  }
  return tools;
}
