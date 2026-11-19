import type { ProjectSeoActionTask } from "@sokosumi/database";
import { seasonalUpdateHasPassed } from "@sokosumi/utils";
import {
  publicDecisionAction,
  readPublicSeoDecisions,
} from "@/helpers/project-seo-decisions";
import { seasonalPayloadActions } from "@/helpers/project-seo-seasonal";
import { SeoContentHistory } from "@/helpers/seo-content-history";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import { normalizeSeoUrl } from "./project-seo-store";
import {
  type AuditScope,
  SeoRecommendationFollowups,
} from "./seo-recommendation-followups";
import type { DecisionPayload } from "./seo-recommendation-history";

type ActionStatus = ProjectSeoWorkspace["actions"][number]["status"];
const terminalStatuses: ReadonlyMap<string, ActionStatus> = new Map([
  ["COMPLETED", "implemented"],
  ["CANCELED", "canceled"],
  ["FAILED", "failed"],
]);

/** Audits arrive newest first. Keep the latest recommendations per page/market and the source of accepted work. */
export class SeoAuditDecisions {
  readonly contentHistory = new SeoContentHistory();
  private readonly followups = new SeoRecommendationFollowups();
  private readonly completed: Map<string, Date>;
  private readonly pages = new Set<string>();
  private readonly considered = new Set<string>();
  private readonly indexes = new Map<string, number>();
  private readonly linked: Map<string, ProjectSeoActionTask>;
  readonly seasonal: NonNullable<ProjectSeoWorkspace["seasonalIdeas"]> = [];
  readonly actions: ProjectSeoWorkspace["actions"] = [];

  get workspaceEvidence() {
    const { articles, groups } = this.contentHistory;
    return {
      ...(articles.length && { articleDates: articles }),
      ...(groups.length && { topicLaunches: groups }),
      ...(this.seasonal.length && { seasonalIdeas: this.seasonal }),
    };
  }

  constructor(
    private readonly selected: Set<string>,
    links: ProjectSeoActionTask[],
    private readonly statuses: Map<string, string>,
    private readonly now: Date,
    taskRows: { id: string; status: string; completedAt: Date | null }[] = [],
  ) {
    this.completed = new Map(
      taskRows.flatMap((t) =>
        t.status === "COMPLETED" && t.completedAt
          ? [[t.id, t.completedAt] as const]
          : [],
      ),
    );
    this.linked = new Map(links.map((link) => [link.actionId, link]));
  }
  append(
    row: AuditScope,
    data: DecisionPayload,
    inPeriod: boolean,
    inFeed = true,
  ) {
    const observationId = row.id;
    if (inFeed && inPeriod) this.contentHistory.append(data, this.selected);
    const decisions = readPublicSeoDecisions(
      data.strategyDecisions,
      data.pageUrls,
      data.decisionSources,
    );
    const seasonal = new Map(
      seasonalPayloadActions(data).map(({ idea, action }) => [idea, action]),
    );
    for (const url of data.pageUrls) {
      const page = normalizeSeoUrl(url);
      if (!this.selected.has(page)) continue;
      const key = JSON.stringify([page, data.countryCode, data.languageCode]);
      const current = inFeed && inPeriod && !this.pages.has(key);
      if (inFeed && inPeriod) this.pages.add(key);
      const followup = this.followups.compare(
        row,
        data,
        url,
        inPeriod,
        this.now,
      );
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
            if (
              id &&
              !this.linked.has(id) &&
              seasonalUpdateHasPassed(idea, this.now)
            )
              return idea;
            return id ? { ...idea, actionId: id } : idea;
          }),
        );
      for (const { action, review: candidate, eligible } of [
        ...(decisions ?? [])
          .filter((d) => normalizeSeoUrl(d.targetUrl) === page)
          .map((d) => ({
            action: publicDecisionAction(
              d,
              data.countryCode,
              data.languageCode,
            ),
            review: followup?.rank(d),
            eligible: true,
          })),
        ...ideas.flatMap((idea) => {
          const action = seasonal.get(idea),
            review = followup?.demand(idea);
          return action &&
            (review ||
              this.linked.has(action.id) ||
              !seasonalUpdateHasPassed(idea, this.now))
            ? [
                {
                  action,
                  review,
                  eligible: !seasonalUpdateHasPassed(idea, this.now),
                },
              ]
            : [];
        }),
      ]) {
        const link = this.linked.get(action.id);
        const original = link?.observationId === observationId;
        const done = link && this.completed.get(link.taskId);
        const episode =
          candidate &&
          JSON.stringify([
            action.id,
            candidate.kind,
            candidate.period,
            candidate.observationId,
          ]);
        const review =
          candidate &&
          episode &&
          !this.considered.has(episode) &&
          !(done && done.getTime() >= Date.parse(candidate.observedAt))
            ? candidate
            : undefined;
        if (episode && (!link || original)) this.considered.add(episode);
        const index = this.indexes.get(action.id);
        if (link && !original && !current) continue;
        if (index !== undefined && !original) {
          const existing = this.actions[index];
          if (review && !existing.followUpReview && !link)
            existing.followUpReview = review;
          continue;
        }
        if (
          !(
            (current && (eligible || link)) ||
            (original && (inPeriod || candidate)) ||
            review
          )
        )
          continue;
        const state = link && this.statuses.get(link.taskId);
        const projected: ProjectSeoWorkspace["actions"][number] = {
          ...action,
          pageUrl: page,
          observationId,
          ...(review && { followUpReview: review }),
          taskId: link?.taskId ?? null,
          status: link
            ? (terminalStatuses.get(state ?? "") ?? "task_created")
            : current && eligible
              ? "recommended"
              : "needs_review",
        };
        if (index === undefined)
          this.indexes.set(action.id, this.actions.push(projected) - 1);
        else this.actions[index] = projected;
      }
    }
  }
}
