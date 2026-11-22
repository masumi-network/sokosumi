import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { parseTeamMock } = vi.hoisted(() => ({
  parseTeamMock: vi.fn(),
}));

vi.mock("@/lib/team-file", () => ({
  parseTeam: parseTeamMock,
}));

import type { Team } from "@/lib/team-file";
import { type TeamFileLoadState, useTeamFile } from "./use-team-file";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const SAMPLE_TEAM: Team = {
  kind: "sokosumi.team",
  version: 1,
  title: "Core Team",
  people: [
    {
      id: "p1",
      name: "Ada Lovelace",
      role: "CTO",
      advisor: false,
      highlights: [],
      experience: [],
      education: [],
    },
  ],
};

describe("useTeamFile", () => {
  afterEach(() => {
    parseTeamMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("fetches and parses team JSON, aborts on url change, handles invalid data, and aborts on unmount", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    parseTeamMock.mockReturnValue(SAMPLE_TEAM);

    const captured: { state: TeamFileLoadState } = {
      state: { status: "loading" },
    };

    function Probe({ url }: { url: string }) {
      captured.state = useTeamFile(url);
      return null;
    }

    const { rerender, unmount } = render(
      <Probe url="https://files.example.com/a.team.json" />,
    );
    expect(captured.state).toEqual({ status: "loading" });

    rerender(<Probe url="https://files.example.com/b.team.json" />);
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      second.resolve(new Response(JSON.stringify(SAMPLE_TEAM)));
      await second.promise;
    });

    await waitFor(() => {
      expect(captured.state).toEqual({ status: "ready", team: SAMPLE_TEAM });
    });

    unmount();
    expect(signals[1]?.aborted).toBe(true);
  });
});
