import type { SokoBotScenario } from "./scenario-types.js";

/** Provider-free model coverage. Core prepares real, isolated lane records. */
export const SEO_EVAL_CAPABILITIES = {
  "seo-workspace-read": "get_seo_workspace",
  "seo-add-page": "add_seo_page",
  "seo-save-page-group": "save_seo_scope",
  "seo-save-keyword": "save_seo_keyword",
  "seo-confirm-competitor": "save_seo_competitor",
  "seo-recommendation-task": "create_seo_action_task",
  "seo-record-page-change": "record_seo_page_change",
  "seo-statistics-disconnected": "list_seo_statistics_properties",
} as const;

// Human CHAT routes are hints. Required actions and Core's saved-record checks
// still prove completion when Jev records CLARIFY for an authorized save.
export const SEO_SCENARIOS: SokoBotScenario[] = [
  {
    id: "seo-workspace-read",
    title: "Read the SEO workspace",
    intent:
      "Reads saved pages and public evidence without refreshing or spending.",
    prompt:
      "Read SEO for Sokosumi Marketing. Tell me which saved pages are available, and distinguish saved configuration from measured findings. Do not refresh, request an audit, or change anything.",
    rubric:
      "Calls get_seo_workspace for the named Project and reports the returned saved page labels or URLs. It does not claim that saving a page measured its performance or verified an improvement. No write, provider request, Task, or hire.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "MIXED"],
      tools: ["get_seo_workspace"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
  {
    id: "seo-add-page",
    title: "Save a related SEO page",
    intent: "Adds a page under its verified parent without starting an audit.",
    prompt:
      "Save the supplied new page in Sokosumi Marketing SEO as a related page of the saved home page, with the supplied label. Saving only: do not audit or fetch the page.",
    rubric:
      "Reads the SEO workspace and calls add_seo_page with the supplied URL and label, relationship related, and the actual saved home page ID. Reports the saved page without claiming an audit ran.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "CLARIFY", "MIXED"],
      tools: ["get_seo_workspace", "add_seo_page"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
  {
    id: "seo-save-page-group",
    title: "Save an SEO page group",
    intent: "Saves exactly the two selected pages as a named group.",
    prompt:
      "In Sokosumi Marketing SEO, save a page group with the supplied name containing only the saved home and pricing pages. Read their actual IDs first. Do not request an audit.",
    rubric:
      "Calls get_seo_workspace and save_seo_scope with the exact supplied group name and both real page IDs, no other page. Reports a saved page group, not a completed audit.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "CLARIFY", "MIXED"],
      tools: ["get_seo_workspace", "save_seo_scope"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
  {
    id: "seo-save-keyword",
    title: "Save an SEO keyword choice",
    intent:
      "Saves an owner-selected keyword, Market, priority, and target page.",
    prompt:
      "In Sokosumi Marketing SEO, save the supplied keyword for the US English Market, high priority, targeting the saved pricing page. This is my saved choice, not a ranking refresh.",
    rubric:
      "Reads the SEO workspace and calls save_seo_keyword with the supplied keyword, US, en, high, saved true and the actual pricing page ID. It reports the saved choice without inventing volume or rank.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "CLARIFY", "MIXED"],
      tools: ["get_seo_workspace", "save_seo_keyword"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
  {
    id: "seo-confirm-competitor",
    title: "Confirm an SEO competitor",
    intent:
      "Stores the owner's competitor choice without inferring it from a search result.",
    prompt:
      "For Sokosumi Marketing SEO, I confirm that the supplied competitor URL is a business competitor. Save that choice as confirmed. Do not fetch it or run a comparison.",
    rubric:
      "Reads the SEO workspace and calls save_seo_competitor with the exact supplied URL and confirmed true. It describes this as the owner's choice, not a measured search competitor or completed analysis.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "CLARIFY", "MIXED"],
      tools: ["get_seo_workspace", "save_seo_competitor"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
  {
    id: "seo-recommendation-task",
    title: "Create a draft Task from SEO evidence",
    intent:
      "Turns a stored public recommendation into one evidence-linked DRAFT Task.",
    prompt:
      "Read Sokosumi Marketing SEO and turn the supplied stored recommendation into a Task. Keep it an unassigned draft. Do not implement it or request a recheck; the expected effect remains a hypothesis.",
    rubric:
      "Calls get_seo_workspace and create_seo_action_task with the real observationId and actionId. Exactly one linked Task exists, DRAFT and unassigned, with source evidence. The answer links the Task and does not claim implementation or SEO improvement.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "CLARIFY",
        "MIXED",
      ],
      tools: ["get_seo_workspace", "create_seo_action_task"],
      forbiddenTools: ["assign_task", "hire_agent"],
      noInventedIds: true,
    },
  },
  {
    id: "seo-record-page-change",
    title: "Record an owner-reported page change",
    intent:
      "Records the specified page, date, and note without claiming verified impact.",
    prompt:
      "In Sokosumi Marketing SEO, record my reported pricing-page change with the supplied time, title and note. This is a manual timeline entry, not proof of implementation or traffic improvement.",
    rubric:
      "Reads the saved pages and calls record_seo_page_change for only the pricing page with the supplied occurredAt, title and note. Reports a recorded owner change, without claiming verification, attribution, or improved traffic.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "CLARIFY", "MIXED"],
      tools: ["get_seo_workspace", "record_seo_page_change"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
  {
    id: "seo-statistics-disconnected",
    title: "Report missing native statistics connection",
    intent:
      "Checks the real disconnected property-list path without guessing a property.",
    prompt:
      "For Sokosumi Marketing SEO, list the Search Console properties available through my native connection. If it is not connected, tell me where to connect it. Do not guess a property or start a sync.",
    rubric:
      "Calls list_seo_statistics_properties for search_console. The lane has no connection, so the real service returns not_connected and no properties. The answer states that connection is needed, without inventing a property, measured statistics, or a completed sync.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "CLARIFY", "MIXED"],
      tools: ["list_seo_statistics_properties"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
];
