import { createTableHook } from "@tanstack/react-table";

import { dataTableFeatures } from "./data-table-features";

/**
 * App-wide DataTable factory. Module scope only.
 * Features are bound; pass columns/data/state per table.
 */
export const { useAppTable, createAppColumnHelper } = createTableHook({
  features: dataTableFeatures,
});
