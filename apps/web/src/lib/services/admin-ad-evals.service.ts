import "server-only";

import { getAdminAdEvals, getAdminAdEvalsExport } from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

export const adminAdEvalsService = {
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
