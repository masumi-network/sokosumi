import { feedItemMatchesQuery } from "@/lib/feed/feed-search";

describe("Feed search functionality", () => {
  const mockFeedItem = {
    id: "task-123",
    title: "Sprint Planning",
    displayTitle: "Sprint Planning Notes",
    previewText: "Reviewed backlog and aligned priorities with the team.",
    actor: {
      name: "Design Coworker",
    },
  };

  it("should return true when no query is provided", () => {
    expect(feedItemMatchesQuery(mockFeedItem, "")).toBe(true);
  });

  it("should match display title", () => {
    expect(feedItemMatchesQuery(mockFeedItem, "Planning Notes")).toBe(true);
  });

  it("should match title", () => {
    expect(feedItemMatchesQuery(mockFeedItem, "Sprint")).toBe(true);
  });

  it("should match preview text", () => {
    expect(feedItemMatchesQuery(mockFeedItem, "backlog")).toBe(true);
  });

  it("should match actor name", () => {
    expect(feedItemMatchesQuery(mockFeedItem, "coworker")).toBe(true);
  });

  it("should match feed item id", () => {
    expect(feedItemMatchesQuery(mockFeedItem, "task-123")).toBe(true);
  });

  it("should be case insensitive", () => {
    expect(feedItemMatchesQuery(mockFeedItem, "SPRINT")).toBe(true);
    expect(feedItemMatchesQuery(mockFeedItem, "DESIGN COWORKER")).toBe(true);
  });

  it("should return false for no matches", () => {
    expect(feedItemMatchesQuery(mockFeedItem, "nonexistent")).toBe(false);
  });

  it("should handle null fields", () => {
    const itemWithNulls = {
      ...mockFeedItem,
      title: null,
      displayTitle: null,
      previewText: null,
      actor: {
        name: null,
      },
    };

    expect(feedItemMatchesQuery(itemWithNulls, "task-123")).toBe(true);
    expect(feedItemMatchesQuery(itemWithNulls, "nonexistent")).toBe(false);
  });
});
