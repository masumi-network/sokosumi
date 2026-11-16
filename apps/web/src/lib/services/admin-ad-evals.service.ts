import "server-only";

import {
  getAdminAdEvals,
  getAdminAdEvalsAccess,
  getAdminAdEvalsExport,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import {
  CoreApiRequestError,
  executeCoreOperation,
} from "@/lib/clients/core.request";

export const adminAdEvalsService = {
  async hasAccess(): Promise<boolean> {
    try {
      const response = await executeCoreOperation(
        createCoreGeneratedClient,
        (client) => getAdminAdEvalsAccess({ client, cache: "no-store" }),
        "Failed to check ad evals access",
      );
      return response.data.hasAccess;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 403) {
        return false;
      }
      throw error;
    }
  },

  async getDashboard() {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => getAdminAdEvals({ client, cache: "no-store" }),
      "Failed to load ad evals",
    );
    return response.data;
  },

  async exportJsonl() {
    return executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        getAdminAdEvalsExport({ client, cache: "no-store", parseAs: "text" }),
      "Failed to export ad evals",
    );
  },
};
