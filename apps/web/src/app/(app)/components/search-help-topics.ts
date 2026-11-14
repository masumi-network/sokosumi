/**
 * Short how-to answers that global search shows next to records, so a new
 * user can type "how do I invite someone" and land on the right page. Text
 * lives in `App.HistorySearchDialog.help.<id>`; this file only knows where
 * each answer leads and in which workspace it applies.
 */

export interface SearchHelpTopicConfig {
  id: string;
  /** Page the answer opens; `null` when the answer is the whole help. */
  href: string | null;
  /** Limit to one kind of workspace; omitted means both. */
  workspace?: "organization" | "personal";
}

export interface SearchHelpTopic {
  id: string;
  href: string | null;
  title: string;
  answer: string;
  keywords: string;
}

export const SEARCH_HELP_TOPICS: readonly SearchHelpTopicConfig[] = [
  { id: "newTask", href: "/tasks" },
  { id: "coworkers", href: "/agents" },
  { id: "sokoBot", href: "/personal-assistant" },
  { id: "inviteTeammates", href: "/organization", workspace: "organization" },
  { id: "startTeam", href: null, workspace: "personal" },
  { id: "credits", href: "/billing" },
  { id: "connectAccounts", href: "/connections" },
  { id: "uploadFiles", href: "/drive" },
  { id: "addContacts", href: "/contacts" },
  { id: "schedules", href: "/schedules" },
  { id: "chatChannel", href: "/chat", workspace: "organization" },
  { id: "projects", href: "/projects" },
  { id: "socialPosts", href: "/social" },
  { id: "notifications", href: "/account/notifications" },
  { id: "apiKeys", href: "/developer/api-keys" },
];

export const SEARCH_HELP_LIMIT = 3;
/** Shorter words ("a", "do", "my") match too much to mean anything. */
const MIN_TOKEN_LENGTH = 3;

export function searchHelpTopicsForWorkspace(
  activeOrganizationId: string | null,
): SearchHelpTopicConfig[] {
  const workspace = activeOrganizationId ? "organization" : "personal";
  return SEARCH_HELP_TOPICS.filter(
    (topic) => !topic.workspace || topic.workspace === workspace,
  );
}

function words(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Topics whose title or keywords start with the most words of the query,
 * best first. A word counts when a topic word starts with it, so "invit"
 * finds "invite" while the user is still typing.
 */
export function matchSearchHelpTopics(
  query: string,
  topics: readonly SearchHelpTopic[],
): SearchHelpTopic[] {
  const tokens = words(query).filter(
    (token) => token.length >= MIN_TOKEN_LENGTH,
  );
  if (tokens.length === 0) {
    return [];
  }

  return topics
    .map((topic) => {
      const topicWords = words(`${topic.title} ${topic.keywords}`);
      const score = tokens.filter((token) =>
        topicWords.some((word) => word.startsWith(token)),
      ).length;
      return { topic, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_HELP_LIMIT)
    .map(({ topic }) => topic);
}
