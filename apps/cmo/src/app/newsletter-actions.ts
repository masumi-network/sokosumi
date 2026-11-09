"use server";

import {
  getContactLists,
  getContacts,
  getNewsletterAvailability,
  getProjectsByIdNewsletter,
  getProjectsByIdNewsletterIssues,
  getProjectsByIdNewsletterIssuesByIssueId,
  getProjectsByIdNewsletterSubscribers,
  postProjectsByIdNewsletterIssuesByIssueIdApprove,
  postProjectsByIdNewsletterIssuesByIssueIdCancel,
  postProjectsByIdNewsletterIssuesByIssueIdSchedule,
  postProjectsByIdNewsletterIssuesByIssueIdSubmit,
  postProjectsByIdNewsletterIssuesPreview,
  postProjectsByIdNewsletterSubscribersFromContacts,
  prepareCmoCalendarNewsletterIssue,
} from "@sokosumi/core-client";

import { errorText } from "../lib/error-text";
import { inCusoWorkspace, requireCore } from "../lib/workspace-options";
import { loadOverview } from "./cmo-actions";

async function newsletterProject(projectId: string) {
  const overview = await loadOverview();
  if (
    !overview ||
    overview.projectId !== projectId ||
    !overview.organizationSlug
  ) {
    throw new Error("The active business has changed");
  }
  return {
    ...(await inCusoWorkspace(overview)),
    path: { id: overview.projectId },
  };
}

export async function loadNewsletter(projectId: string) {
  const { path, ...options } = await newsletterProject(projectId);
  const availability = await getNewsletterAvailability(options);
  if (!availability.data) throw new Error("Could not check newsletter access");
  if (!availability.data.data.enabled) return { state: "disabled" } as const;

  const project = { ...options, path };
  const settings = await getProjectsByIdNewsletter(project);
  if (settings.response?.status === 404) return { state: "setup" } as const;
  if (!settings.data) throw new Error("Could not load newsletter settings");

  const [lists, issues, subscribers] = await Promise.all([
    getContactLists(options),
    getProjectsByIdNewsletterIssues({ ...project, query: { limit: 20 } }),
    getProjectsByIdNewsletterSubscribers({ ...project, query: { limit: 1 } }),
  ]);
  if (!lists.data || !issues.data || !subscribers.data) {
    throw new Error("Could not load the newsletter");
  }
  const { name, publicSlug, contactListId } = settings.data.data;
  return {
    state: "ready",
    name,
    publicSlug,
    lists: lists.data.data
      .filter((list) => list.id !== contactListId)
      .map(({ id, name, count }) => ({ id, name, count })),
    counts: subscribers.data.data.counts,
    issues: issues.data.data.map(
      ({ id, subject, status, approvedAt, scheduledAt }) => ({
        id,
        subject,
        status,
        approvedAt,
        scheduledAt,
      }),
    ),
  } as const;
}

export async function subscribeNewsletterContacts(
  projectId: string,
  selection: { source: "list" | "contact"; id: string },
  consent: string,
) {
  if (consent !== "CONFIRMED" && consent !== "ASK") {
    return { error: "Choose how to confirm consent." };
  }
  const { source, id } = selection;
  if (!id || (source !== "list" && source !== "contact")) {
    return { error: "Choose a contact or a list." };
  }
  const options = await newsletterProject(projectId);
  const { data, error } =
    await postProjectsByIdNewsletterSubscribersFromContacts({
      ...options,
      body: {
        ...(source === "list" ? { listIds: [id] } : { contactIds: [id] }),
        consent,
      },
    });
  if (!data) return { error: errorText(error, "Could not add subscribers.") };
  return { result: data.data };
}

export async function searchNewsletterContacts(
  projectId: string,
  query: string,
) {
  const search = query.trim();
  if (!search) return [];
  const { path: _, ...options } = await newsletterProject(projectId);
  const { data } = await getContacts({
    ...options,
    query: { search, sort: "name", direction: "asc", limit: 20 },
  });
  if (!data) throw new Error("Could not search contacts");

  return data.data.map(({ id, name, channels }) => ({
    id,
    name,
    email:
      channels.find((channel) => channel.type === "EMAIL" && channel.isPrimary)
        ?.value ??
      channels.find((channel) => channel.type === "EMAIL")?.value ??
      null,
  }));
}

interface CalendarDraftCursors {
  draft: string | null;
  review: string | null;
}

export async function loadCalendarDrafts(
  projectId: string,
  cursors?: CalendarDraftCursors,
) {
  const options = await newsletterProject(projectId);
  async function page(
    status: "DRAFT" | "NEEDS_APPROVAL",
    cursor: string | null | undefined,
  ) {
    if (cursor === null) return null;
    const { data } = await getProjectsByIdNewsletterIssues({
      ...options,
      query: { status, cursor, limit: 20 },
    });
    if (!data) throw new Error("Could not load existing newsletter drafts");
    return data;
  }
  const [draft, review] = await Promise.all([
    page("DRAFT", cursors?.draft),
    page("NEEDS_APPROVAL", cursors?.review),
  ]);
  return {
    issues: [...(draft?.data ?? []), ...(review?.data ?? [])].map(
      ({ id, subject }) => ({ id, subject }),
    ),
    next: {
      draft: draft?.meta.pagination.nextCursor ?? null,
      review: review?.meta.pagination.nextCursor ?? null,
    },
  };
}

export async function prepareCalendarIssue(
  projectId: string,
  strategyId: string,
  entryId: string,
  issueId?: string,
) {
  const core = await requireCore();
  const { data, error } = await prepareCmoCalendarNewsletterIssue({
    ...core,
    path: { id: entryId },
    body: { projectId, strategyId, issueId },
  });
  if (!data)
    return {
      error: errorText(error, "Could not prepare the newsletter issue."),
    };
  return { issueId: data.data.issueId };
}

export async function previewNewsletterIssue(
  projectId: string,
  issueId: string,
) {
  const options = await newsletterProject(projectId);
  const { data } = await getProjectsByIdNewsletterIssuesByIssueId({
    ...options,
    path: { ...options.path, issueId },
  });
  if (!data) throw new Error("Could not open the issue");
  const {
    subject,
    previewText,
    template,
    content,
    revision,
    status,
    approvedAt,
  } = data.data;
  const preview = await postProjectsByIdNewsletterIssuesPreview({
    ...options,
    body: { subject, previewText, template, content },
  }).catch(() => null);
  return {
    id: issueId,
    subject,
    previewText,
    revision,
    status,
    approvedAt,
    html: preview?.data?.data.html ?? null,
  };
}

type IssueChange =
  | { action: "submit" | "approve" | "cancel" }
  | { action: "schedule"; scheduledAt: Date; timezone: string };

export async function changeNewsletterIssue(
  projectId: string,
  issueId: string,
  revision: number,
  change: IssueChange,
): Promise<string | null> {
  const project = await newsletterProject(projectId);
  const options = {
    ...project,
    path: { ...project.path, issueId },
    body: { revision },
  };
  switch (change.action) {
    case "submit": {
      const { data, error } =
        await postProjectsByIdNewsletterIssuesByIssueIdSubmit(options);
      return data ? null : errorText(error, "Could not request review.");
    }
    case "approve": {
      const { data, error } =
        await postProjectsByIdNewsletterIssuesByIssueIdApprove(options);
      return data ? null : errorText(error, "Could not approve the issue.");
    }
    case "schedule": {
      const { data, error } =
        await postProjectsByIdNewsletterIssuesByIssueIdSchedule({
          ...options,
          body: {
            revision,
            scheduledAt: change.scheduledAt,
            timezone: change.timezone,
          },
        });
      return data ? null : errorText(error, "Could not schedule the issue.");
    }
    case "cancel": {
      const { data, error } =
        await postProjectsByIdNewsletterIssuesByIssueIdCancel(options);
      return data ? null : errorText(error, "Could not cancel the send.");
    }
    default:
      return "Unknown newsletter action.";
  }
}
