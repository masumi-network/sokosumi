import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  chatQueryKeys,
  normalizeChatScope,
  splitChatQueryKey,
} from "@/queries/chat";
import { buildScopedQueryKey, useScopedQuery } from "@/queries/scoped-queries";

const scopeA = { userId: "user_a", workspaceId: "org_a" };
const scopeB = { userId: "user_a", workspaceId: "org_b" };
const personal = { userId: "user_a", workspaceId: null };

describe("chatQueryKeys", () => {
  it("normalizes scope with scope first, then chat root and resource", () => {
    expect(
      normalizeChatScope({ userId: "user_a", workspaceId: undefined }),
    ).toEqual(personal);
    expect(normalizeChatScope()).toEqual({ userId: null, workspaceId: null });

    expect(chatQueryKeys.prefix(scopeA)).toEqual([scopeA, "chat"]);
    expect(chatQueryKeys.sidebarRooms(scopeA)).toEqual([
      scopeA,
      "chat",
      "sidebar-rooms",
    ]);
    expect(chatQueryKeys.sidebarRoomCollection(scopeA, "active")).toEqual([
      scopeA,
      "chat",
      "sidebar-rooms",
      "active",
    ]);
    expect(chatQueryKeys.roster(scopeA, "room_1")).toEqual([
      scopeA,
      "chat",
      "roster",
      "room_1",
    ]);
    expect(chatQueryKeys.transcripts(scopeA)).toEqual([
      scopeA,
      "chat",
      "transcript",
    ]);
    expect(chatQueryKeys.transcript(scopeA, "room_1")).toEqual([
      scopeA,
      "chat",
      "transcript",
      "room_1",
    ]);
    expect(chatQueryKeys.elsewhere(scopeA)).toEqual([
      scopeA,
      "chat",
      "elsewhere",
    ]);
    expect(chatQueryKeys.threads(scopeA, "room_1")).toEqual([
      scopeA,
      "chat",
      "threads",
      "room_1",
    ]);
    expect(chatQueryKeys.openAtUnread(scopeA, "room_1", 2)).toEqual([
      scopeA,
      "chat",
      "open-at-unread",
      "room_1",
      2,
    ]);
  });

  it("round-trips splitChatQueryKey through buildScopedQueryKey", () => {
    const fullKey = chatQueryKeys.transcript(scopeA, "room_1");
    const split = splitChatQueryKey(fullKey);

    expect(split).toEqual({
      scope: scopeA,
      queryKey: ["chat", "transcript", "room_1"],
    });
    expect(buildScopedQueryKey(split.scope, split.queryKey)).toEqual(fullKey);
  });

  it("matches all user and workspace scopes with cross-scope prefixes without matching other domains", () => {
    const queryClient = new QueryClient();
    const transcriptA = chatQueryKeys.transcript(scopeA, "room_1");
    const transcriptPersonal = chatQueryKeys.transcript(personal, "room_2");
    const elsewhereA = chatQueryKeys.elsewhere(scopeA);
    const elsewhereB = chatQueryKeys.elsewhere(scopeB);
    const driveKey = [{ scope: "me" }, "drive", "folders"] as const;

    queryClient.setQueryDefaults(chatQueryKeys.anyTranscript(), {
      gcTime: 1800_000,
      enabled: false,
      structuralSharing: false,
    });

    expect(queryClient.getQueryDefaults(transcriptA)).toMatchObject({
      gcTime: 1800_000,
      enabled: false,
      structuralSharing: false,
    });
    expect(queryClient.getQueryDefaults(transcriptPersonal)).toMatchObject({
      gcTime: 1800_000,
      enabled: false,
      structuralSharing: false,
    });
    expect(queryClient.getQueryDefaults(elsewhereA)).toEqual({});
    expect(queryClient.getQueryDefaults(driveKey)).toEqual({});

    queryClient.setQueryData(elsewhereA, ["room-a"]);
    queryClient.setQueryData(elsewhereB, ["room-b"]);
    queryClient.setQueryData(transcriptA, ["msg-a"]);

    queryClient.setQueriesData<string[]>(
      { queryKey: chatQueryKeys.anyElsewhere() },
      (rows) => rows?.map((row) => `${row}:updated`),
    );

    expect(queryClient.getQueryData(elsewhereA)).toEqual(["room-a:updated"]);
    expect(queryClient.getQueryData(elsewhereB)).toEqual(["room-b:updated"]);
    expect(queryClient.getQueryData(transcriptA)).toEqual(["msg-a"]);
  });

  it("shows no rows from the previous workspace when switching workspace", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const workspaceBDeferred = Promise.withResolvers<string[]>();

    function WorkspaceChatRows({ workspaceId }: { workspaceId: string }) {
      const { data } = useScopedQuery({
        ...splitChatQueryKey(
          chatQueryKeys.sidebarRoomCollection(
            { userId: "user_a", workspaceId },
            "active",
          ),
        ),
        queryFn: () =>
          workspaceId === "org_a"
            ? Promise.resolve(["Alpha Room"])
            : workspaceBDeferred.promise,
      });

      return (
        <ul>
          {(data ?? []).map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      );
    }

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceChatRows workspaceId="org_a" />
      </QueryClientProvider>,
    );

    await screen.findByText("Alpha Room");

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkspaceChatRows workspaceId="org_b" />
      </QueryClientProvider>,
    );

    // While org_b is still loading, org_a's rows must not appear.
    expect(screen.queryByText("Alpha Room")).toBeNull();

    workspaceBDeferred.resolve(["Beta Room"]);
    await waitFor(() => {
      expect(screen.getByText("Beta Room")).toBeTruthy();
    });
    expect(screen.queryByText("Alpha Room")).toBeNull();
  });
});
