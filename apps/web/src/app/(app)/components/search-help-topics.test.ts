import { describe, expect, it } from "vitest";
import {
  matchSearchHelpTopics,
  SEARCH_HELP_LIMIT,
  type SearchHelpTopic,
  searchHelpTopicsForWorkspace,
} from "@/app/components/search-help-topics";
import de from "../../../../messages/de.json";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";

function topic(id: string, title: string, keywords: string): SearchHelpTopic {
  return { id, href: `/${id}`, title, answer: "", keywords };
}

const TOPICS = [
  topic("invite", "Invite teammates", "invite team member colleague"),
  topic("credits", "Get more credits", "credits buy billing plan"),
  topic("files", "Upload files", "file upload folder"),
];

describe("matchSearchHelpTopics", () => {
  it("finds the topic a question is about", () => {
    expect(
      matchSearchHelpTopics("How do I invite a colleague?", TOPICS).map(
        (match) => match.id,
      ),
    ).toEqual(["invite"]);
  });

  it("matches a word the user is still typing", () => {
    expect(matchSearchHelpTopics("invi", TOPICS)[0]?.id).toBe("invite");
  });

  it("ranks the topic that matches more words first", () => {
    expect(
      matchSearchHelpTopics("buy a plan for my team", TOPICS).map(
        (match) => match.id,
      ),
    ).toEqual(["credits", "invite"]);
  });

  it("ignores case and accents", () => {
    const topics = [topic("contacts", "Añadir contactos", "contacto crm")];
    expect(matchSearchHelpTopics("ANADIR", topics)[0]?.id).toBe("contacts");
  });

  it("shows nothing for an empty query or only short words", () => {
    expect(matchSearchHelpTopics("", TOPICS)).toEqual([]);
    expect(matchSearchHelpTopics("do i a", TOPICS)).toEqual([]);
  });

  it("shows nothing when no topic fits", () => {
    expect(matchSearchHelpTopics("quarterly roadmap", TOPICS)).toEqual([]);
  });

  it(`shows at most ${SEARCH_HELP_LIMIT} topics`, () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      topic(`t${index}`, "Tasks", "task"),
    );
    expect(matchSearchHelpTopics("task", many)).toHaveLength(SEARCH_HELP_LIMIT);
  });
});

describe("searchHelpTopicsForWorkspace", () => {
  it("offers inviting in an organization and starting one when personal", () => {
    const orgIds = searchHelpTopicsForWorkspace("org-1").map(({ id }) => id);
    const personalIds = searchHelpTopicsForWorkspace(null).map(({ id }) => id);

    expect(orgIds).toContain("inviteTeammates");
    expect(orgIds).not.toContain("startTeam");
    expect(personalIds).toContain("startTeam");
    expect(personalIds).not.toContain("inviteTeammates");
  });

  it("has a title, answer and keywords for every topic in every locale", () => {
    for (const messages of [en, de, es]) {
      const help: Record<string, Record<string, string>> = messages.App
        .HistorySearchDialog.help;
      for (const { id } of [
        ...searchHelpTopicsForWorkspace("org-1"),
        ...searchHelpTopicsForWorkspace(null),
      ]) {
        expect(help[id]?.title).toBeTruthy();
        expect(help[id]?.answer).toBeTruthy();
        expect(help[id]?.keywords).toBeTruthy();
      }
    }
  });
});
