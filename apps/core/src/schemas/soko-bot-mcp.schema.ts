import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/** A server's tool with the owner's switch and label (ADR 0074). */
export const sokoBotMcpToolSchema = z
  .object({
    name: z.string().openapi({ example: "search_issues" }),
    description: z.string().nullable(),
    inputSchema: z.unknown(),
    readOnly: z.boolean().openapi({
      description: "Reads when true; changes things when false",
    }),
    enabled: z.boolean(),
  })
  .openapi("SokoBotMcpTool");

/** A connected server as the owner sees it: never its credential. */
export const sokoBotMcpServerSchema = z
  .object({
    id: z.uuid(),
    name: z.string().openapi({ example: "Linear" }),
    url: z.string().openapi({ example: "https://mcp.linear.app/mcp" }),
    authKind: z.string().openapi({ example: "header" }),
    tools: z.array(sokoBotMcpToolSchema),
    toolsRefreshedAt: dateTimeSchema.nullable(),
    lastError: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotMcpServer");

/** Header names that belong to the transport, not to a credential. */
const TRANSPORT_HEADERS =
  /^(host|content-length|content-type|accept|connection|transfer-encoding|cookie|mcp-.*)$/i;

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("bearer"),
    token: z.string().trim().min(1).max(8_000),
  }),
  z.object({
    type: z.literal("header"),
    name: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/, "Letters, digits and hyphens only")
      .refine((name) => !TRANSPORT_HEADERS.test(name), {
        message: "This header is set by the connection itself",
      }),
    value: z
      .string()
      .min(1)
      .max(8_000)
      .refine((value) => !/[\r\n\0]/.test(value), {
        message: "A header value is one line",
      }),
  }),
]);

export const addSokoBotMcpServerRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/,
        "Up to 40 letters, digits, spaces, dots, hyphens or underscores",
      )
      .openapi({ example: "Linear" }),
    url: z.string().trim().max(2_000).openapi({
      example: "https://mcp.linear.app/mcp",
    }),
    auth: authSchema,
  })
  .openapi("AddSokoBotMcpServerRequest");

export const updateSokoBotMcpToolRequestSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    readOnly: z.boolean().optional(),
  })
  .openapi("UpdateSokoBotMcpToolRequest");
