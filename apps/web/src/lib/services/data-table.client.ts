import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import {
  getCoworkers,
  getDriveTables,
  getDriveTablesById,
  getDriveTablesByIdHistory,
  getMySokoBot,
  getProjects,
  type PatchDriveTablesByIdData,
  type PostDriveTablesByIdEnrichData,
  type PostDriveTablesByIdQueryData,
  type PostDriveTablesByIdRowsData,
  type PostDriveTablesByIdViewsData,
  type PostDriveTablesData,
  patchDriveTablesById,
  postDriveTables,
  postDriveTablesByIdEnrich,
  postDriveTablesByIdQuery,
  postDriveTablesByIdRows,
  postDriveTablesByIdUndo,
  postDriveTablesByIdViews,
} from "@/lib/clients/generated/core";

function options() {
  return { client: getBrowserCoreClient(), throwOnError: true as const };
}
export const dataTableService = {
  async projects() {
    return (await getProjects({ ...options(), query: { limit: 100 } })).data
      .data;
  },
  async agents() {
    const [coworkers, bot] = await Promise.all([
      getCoworkers({
        ...options(),
        query: { scope: "available", capability: ["tasks"] },
      }),
      getMySokoBot({ ...options() })
        .then((result) => result.data.data.sokoBot)
        .catch(() => null),
    ]);
    return { coworkers: coworkers.data.data, bot };
  },
  async list(
    query: {
      cursor?: string;
      archived?: "true" | "false";
      projectId?: string;
    } = {},
  ) {
    const { data } = await getDriveTables({ ...options(), query });
    return { items: data.data, nextCursor: data.meta.pagination.nextCursor };
  },
  async get(id: string) {
    return (await getDriveTablesById({ ...options(), path: { id } })).data.data;
  },
  async create(body: PostDriveTablesData["body"]) {
    return (await postDriveTables({ ...options(), body })).data.data;
  },
  async query(id: string, body: PostDriveTablesByIdQueryData["body"]) {
    const { data } = await postDriveTablesByIdQuery({
      ...options(),
      path: { id },
      body,
    });
    return { rows: data.data, nextCursor: data.meta.pagination.nextCursor };
  },
  async batch(id: string, body: PostDriveTablesByIdRowsData["body"]) {
    return (await postDriveTablesByIdRows({ ...options(), path: { id }, body }))
      .data.data;
  },
  async update(id: string, body: PatchDriveTablesByIdData["body"]) {
    return (await patchDriveTablesById({ ...options(), path: { id }, body }))
      .data.data;
  },
  async view(id: string, body: PostDriveTablesByIdViewsData["body"]) {
    return (
      await postDriveTablesByIdViews({ ...options(), path: { id }, body })
    ).data.data;
  },
  async history(
    id: string,
    query: { rowId?: string; columnId?: string; cursor?: string } = {},
  ) {
    const { data } = await getDriveTablesByIdHistory({
      ...options(),
      path: { id },
      query,
    });
    return { items: data.data, nextCursor: data.meta.pagination.nextCursor };
  },
  async undo(id: string, batchId: string, key: string) {
    return (
      await postDriveTablesByIdUndo({
        ...options(),
        path: { id },
        body: { batchId, key },
      })
    ).data.data;
  },
  async enrich(id: string, body: PostDriveTablesByIdEnrichData["body"]) {
    return (
      await postDriveTablesByIdEnrich({ ...options(), path: { id }, body })
    ).data.data;
  },
};
