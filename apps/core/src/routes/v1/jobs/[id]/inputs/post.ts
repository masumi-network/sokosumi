import { createRoute, z } from "@hono/zod-openapi";
import { AgentJobStatus, type SharedDb } from "@sokosumi/database";
import { netType } from "@sokosumi/database/sql-tables";
import { createAgentClient } from "@sokosumi/masumi";

import { requireJobCollaboration } from "@/helpers/access-control.js";
import { toMasumiAgentForJob } from "@/helpers/agent";
import {
  badRequest,
  conflict,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { type NetworkScope, sharedTxAsNetworkDb } from "@/lib/db/network-scope";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { jobInputSchema } from "@/schemas/job.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const requestBodySchema = z.object({
  eventId: z.string().openapi({
    example: "event_123",
    description: "The ID of the job event that is awaiting input",
  }),
  inputData: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        z.array(z.number()),
      ]),
    )
    .openapi({
      example: {
        answer: "8",
        notes: "Pluto is now classified as a dwarf planet",
      },
      description:
        "Input data matching the input schema from the input request",
    }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/inputs",
    description: "Provide input for a job awaiting input",
    tags: ["Jobs"],
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: requestBodySchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(jobInputSchema, "Input provided successfully", {
        data: {
          id: "cmi4gmksz000104l8wps8p7fp",
          input: '{"prompt":"How many planets are in the solar system?"}',
          inputHash: "input_hash",
          signature: "signature",
        },
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - Input already provided"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

interface SplitAwaitingInputRow {
  id: string;
  inputSchema: string | null;
  hasInput: boolean;
  agentJobId: string;
  agentBlockchainIdentifier: string | null;
  agentApiBaseUrl: string | null;
  agentId: string;
  agentCurrentBlockchainIdentifier: string;
  agentName: string;
  agentCurrentApiBaseUrl: string | null;
  hasOverride: boolean;
  overrideApiBaseUrl: string | null;
}

async function readAwaitingInputJobEventOnSplit(
  tx: SharedDb,
  scope: NetworkScope,
  jobId: string,
  eventId: string,
) {
  const [row] = await tx.$queryRaw<SplitAwaitingInputRow[]>`
    SELECT
      e."id",
      e."inputSchema",
      (ji."id" IS NOT NULL) AS "hasInput",
      j."agentJobId",
      j."agentBlockchainIdentifier",
      j."agentApiBaseUrl",
      a."id" AS "agentId",
      a."blockchainIdentifier" AS "agentCurrentBlockchainIdentifier",
      a."name" AS "agentName",
      a."apiBaseUrl" AS "agentCurrentApiBaseUrl",
      (amo."id" IS NOT NULL) AS "hasOverride",
      amo."apiBaseUrl" AS "overrideApiBaseUrl"
    FROM ${scope.networkTable("jobEvent")} e
    INNER JOIN ${scope.networkTable("Job")} j ON j."id" = e."jobId"
    INNER JOIN ${scope.networkTable("Agent")} a ON a."id" = j."agentId"
    LEFT JOIN ${scope.networkTable("AgentMetadataOverride")} amo ON amo."agentId" = a."id"
    LEFT JOIN ${scope.networkTable("jobInput")} ji ON ji."eventId" = e."id"
    WHERE e."id" = ${eventId}
      AND e."jobId" = ${jobId}
      AND e."status" = ${AgentJobStatus.AWAITING_INPUT}::text::${netType(scope.network, "AgentJobStatus")}
    LIMIT 1
  `;
  if (!row) return null;
  return {
    id: row.id,
    inputSchema: row.inputSchema,
    input: row.hasInput ? { id: "present" } : null,
    job: {
      agentJobId: row.agentJobId,
      agentBlockchainIdentifier: row.agentBlockchainIdentifier,
      agentApiBaseUrl: row.agentApiBaseUrl,
      agent: {
        id: row.agentId,
        blockchainIdentifier: row.agentCurrentBlockchainIdentifier,
        name: row.agentName,
        apiBaseUrl: row.agentCurrentApiBaseUrl,
        metadataOverride: row.hasOverride
          ? { apiBaseUrl: row.overrideApiBaseUrl }
          : null,
      },
    },
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: jobId } = c.req.valid("param");
    const { eventId, inputData } = c.req.valid("json");

    if (Object.keys(inputData).length === 0) {
      throw badRequest("Input data cannot be empty");
    }

    const { networkScope } = c.var;
    const { networkDb } = networkScope;

    const jobEvent = await networkScope.sharedTransactionOnce(async (tx) => {
      await requireJobCollaboration(c.var.authContext, jobId, networkScope, {
        sharedTx: tx,
      });
      const txNetworkDb = sharedTxAsNetworkDb(networkScope, tx);
      const jobEvent = txNetworkDb
        ? await txNetworkDb.jobEvent.findFirst({
            where: {
              id: eventId,
              jobId,
              status: AgentJobStatus.AWAITING_INPUT,
            },
            include: {
              job: {
                include: {
                  agent: {
                    select: {
                      id: true,
                      blockchainIdentifier: true,
                      name: true,
                      apiBaseUrl: true,
                      metadataOverride: {
                        select: {
                          apiBaseUrl: true,
                        },
                      },
                    },
                  },
                },
              },
              input: true,
            },
          })
        : await readAwaitingInputJobEventOnSplit(
            tx,
            networkScope,
            jobId,
            eventId,
          );

      if (!jobEvent) {
        throw notFound("Job event not found or is not awaiting input");
      }

      if (jobEvent.input !== null) {
        throw conflict("Input has already been provided for this event");
      }

      return jobEvent;
    });

    if (!jobEvent.inputSchema) {
      throw unprocessableEntity("Agent did not provide an input schema");
    }

    // No agent-status gate here on purpose. main has none, and adding one
    // regressed FREE jobs: one whose agent went offline mid-run could no
    // longer receive the input it had just been asked for, and free jobs have
    // no refund path, so it was stuck permanently. Jobs
    // are pinned to their own endpoint snapshot (toMasumiAgentForJob), so a
    // newer, offline agent revision cannot redirect an in-flight job.

    const provideInputResult = await createAgentClient().provideJobInput(
      toMasumiAgentForJob(jobEvent.job),
      jobEvent.job.agentJobId,
      jobEvent.inputSchema,
      inputData,
    );

    if (provideInputResult.isErr()) {
      throw unprocessableEntity(provideInputResult.error.message);
    }

    const jobInput = await networkDb.jobInput.create({
      data: {
        event: { connect: { id: jobEvent.id } },
        input: JSON.stringify(inputData),
        inputHash: provideInputResult.value.input_hash,
        signature: provideInputResult.value.signature,
      },
    });

    const result = {
      id: jobInput.id,
      input: jobInput.input,
      inputHash: jobInput.inputHash,
      signature: jobInput.signature,
    };

    return created(c, jobInputSchema.parse(result));
  });
}
