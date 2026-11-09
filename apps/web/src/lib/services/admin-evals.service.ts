import "server-only";

import type {
  CreateEvalRunBody,
  EvalCaseBaseline,
  EvalCaseDefinition,
  EvalRun,
  EvalRunListItem,
  EvalRunReport,
} from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

/** Eval runs: the daily run on main, runs started by hand, and their reports. */
export const adminEvalsService = {
  async listRuns(limit = 30): Promise<EvalRunListItem[]> {
    return (await coreClient.listAdminEvalRuns({ limit })).data;
  },

  async getRun(id: string): Promise<EvalRunReport> {
    return (await coreClient.getAdminEvalRun(id)).data;
  },

  async getBaseline(id: string, caseId: string): Promise<EvalCaseBaseline> {
    return (await coreClient.getAdminEvalCaseBaseline(id, caseId)).data;
  },

  async listCases(): Promise<EvalCaseDefinition[]> {
    return (await coreClient.listAdminEvalCases()).data;
  },

  async createRun(body: CreateEvalRunBody): Promise<EvalRun> {
    return (await coreClient.createAdminEvalRun(body)).data;
  },

  async cancelRun(id: string): Promise<EvalRun> {
    return (await coreClient.cancelAdminEvalRun(id)).data;
  },
};
