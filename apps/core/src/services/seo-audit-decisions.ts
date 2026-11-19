import type { ProjectSeoActionTask } from "@sokosumi/database";
import { seasonalUpdateHasPassed } from "@sokosumi/utils";
import {
  publicDecisionAction,
  readPublicSeoDecisions,
} from "@/helpers/project-seo-decisions";
import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import { seasonalPayloadActions } from "@/helpers/project-seo-seasonal";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import { normalizeSeoUrl } from "./project-seo-store";

type ActionStatus = ProjectSeoWorkspace["actions"][number]["status"];
const terminalStatuses: ReadonlyMap<string, ActionStatus> = new Map([
  ["COMPLETED", "implemented"],
  ["CANCELED", "canceled"],
  ["FAILED", "failed"],
]);

/** Audits arrive newest first. Keep the latest recommendations per page/market and the source of accepted work. */
export class SeoAuditDecisions {
  private readonly pages = new Set<string>();
  private readonly indexes = new Map<string, number>();
  private readonly linked: Map<string, ProjectSeoActionTask>;
  readonly seasonal: NonNullable<ProjectSeoWorkspace["seasonalIdeas"]> = [];
  readonly actions: ProjectSeoWorkspace["actions"] = [];

  constructor(
    private readonly selected: Set<string>,
    links: ProjectSeoActionTask[],
    private readonly statuses: Map<string, string>,
    private readonly now: Date,
  ) {
    this.linked = new Map(links.map((link) => [link.actionId, link]));
  }
  append(observationId: string, data: PublicSeoPayload) {
    const decisions = readPublicSeoDecisions(
      data.strategyDecisions,
      data.pageUrls,
      data.decisionSources,
    );
    const seasonal = new Map(
      seasonalPayloadActions(data)
        .filter(
          ({ idea, action }) =>
            this.linked.has(action.id) ||
            !seasonalUpdateHasPassed(idea, this.now),
        )
        .map((row) => [row.idea, row.action]),
    );
    for (const url of data.pageUrls) {
      const page = normalizeSeoUrl(url);
      if (!this.selected.has(page)) continue;
      const key = JSON.stringify([page, data.countryCode, data.languageCode]);
      const current = !this.pages.has(key);
      this.pages.add(key);
      const ideas = (data.seasonalIdeas ?? []).filter(
        (idea) =>
          normalizeSeoUrl(idea.url) === page &&
          idea.country === data.countryCode &&
          idea.language === data.languageCode,
      );
      if (current)
        this.seasonal.push(
          ...ideas.map((idea) => {
            const id = seasonal.get(idea)?.id;
            return id ? { ...idea, actionId: id } : idea;
          }),
        );
      for (const action of [
        ...(decisions ?? [])
          .filter((decision) => normalizeSeoUrl(decision.targetUrl) === page)
          .map((decision) =>
            publicDecisionAction(decision, data.countryCode, data.languageCode),
          ),
        ...ideas.flatMap((idea) => seasonal.get(idea) ?? []),
      ]) {
        const link = this.linked.get(action.id);
        const index = this.indexes.get(action.id);
        const original = link?.observationId === observationId;
        if (!original && (!current || index !== undefined)) continue;
        const state = link && this.statuses.get(link.taskId);
        const projected: ProjectSeoWorkspace["actions"][number] = {
          ...action,
          observationId,
          taskId: link?.taskId ?? null,
          status: link
            ? (terminalStatuses.get(state ?? "") ?? "task_created")
            : "recommended",
        };
        if (index === undefined)
          this.indexes.set(action.id, this.actions.push(projected) - 1);
        else this.actions[index] = projected;
      }
    }
  }
}
