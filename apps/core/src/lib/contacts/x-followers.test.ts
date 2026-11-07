import { describe, expect, it } from "vitest";
import {
  isLikelyBot,
  type MatchContact,
  matchFollower,
  ownHost,
  parseXFollower,
  type XFollower,
} from "./x-followers";

function follower(overrides: Partial<XFollower> = {}): XFollower {
  return {
    id: "1",
    username: "ninak",
    name: "Nina Keller",
    description: "Designer",
    location: "",
    website: null,
    avatarUrl: "https://pbs.twimg.com/a_400x400.jpg",
    defaultAvatar: false,
    protected: false,
    followers: 300,
    following: 200,
    posts: 50,
    ...overrides,
  };
}

function contact(overrides: Partial<MatchContact> = {}): MatchContact {
  return {
    id: "c1",
    name: "Nina Keller",
    organization: null,
    location: null,
    channels: [],
    ...overrides,
  };
}

describe("parseXFollower", () => {
  it("reads the profile, its expanded link and a large avatar", () => {
    expect(
      parseXFollower({
        id: "9",
        username: "ninak",
        name: "Nina Keller",
        description: "Design at Acme",
        location: "Zurich",
        url: "https://t.co/abc",
        entities: { url: { urls: [{ expanded_url: "https://nina.design" }] } },
        profile_image_url: "https://pbs.twimg.com/p/x_normal.jpg",
        public_metrics: {
          followers_count: 10,
          following_count: 5,
          tweet_count: 3,
        },
      }),
    ).toMatchObject({
      website: "https://nina.design",
      avatarUrl: "https://pbs.twimg.com/p/x_400x400.jpg",
      defaultAvatar: false,
      followers: 10,
      posts: 3,
    });
  });
});

describe("isLikelyBot", () => {
  it("keeps people and drops empty and follow-spam accounts", () => {
    expect(isLikelyBot(follower())).toBe(false);
    expect(
      isLikelyBot(follower({ description: "", defaultAvatar: true })),
    ).toBe(true);
    expect(isLikelyBot(follower({ description: "", protected: true }))).toBe(
      true,
    );
    expect(isLikelyBot(follower({ posts: 0, followers: 1 }))).toBe(true);
    expect(isLikelyBot(follower({ following: 4_000, followers: 50 }))).toBe(
      true,
    );
  });
});

describe("ownHost", () => {
  it("names a personal or company site, not a link service", () => {
    expect(ownHost("https://www.Acme.com/team")).toBe("acme.com");
    expect(ownHost("https://linktr.ee/nina")).toBeNull();
    expect(ownHost(null)).toBeNull();
  });
});

describe("matchFollower", () => {
  it("never matches on the name alone, or the city on top of it", () => {
    expect(matchFollower(follower(), [contact()])).toBeNull();
    expect(
      matchFollower(follower({ location: "Zurich, CH" }), [
        contact({ location: "Zurich, Switzerland" }),
      ]),
    ).toBeNull();
  });

  it("matches the name with the company in the bio or their own site", () => {
    expect(
      matchFollower(follower({ description: "Design lead at Acme" }), [
        contact({ channels: [{ type: "EMAIL", value: "nina@acme.com" }] }),
      ]),
    ).toEqual({ contactId: "c1", score: 0.75 });
    expect(
      matchFollower(follower({ website: "https://nina.design" }), [
        contact({
          channels: [{ type: "WEBSITE", value: "https://nina.design" }],
        }),
      ]),
    ).toEqual({ contactId: "c1", score: 1 });
  });

  it("matches a first and last name when a LinkedIn profile agrees", () => {
    expect(
      matchFollower(
        follower({
          name: "Nina M. Keller",
          website: "https://linkedin.com/in/ninakeller",
        }),
        [
          contact({
            channels: [
              { type: "LINKEDIN", value: "https://linkedin.com/in/ninakeller" },
            ],
          }),
        ],
      ),
    ).toMatchObject({ contactId: "c1" });
  });

  it("does not use a freemail domain, a different name, or a tie", () => {
    const acme = { channels: [{ type: "EMAIL", value: "nina@acme.com" }] };
    expect(
      matchFollower(follower({ description: "loves gmail" }), [
        contact({ channels: [{ type: "EMAIL", value: "nina@gmail.com" }] }),
      ]),
    ).toBeNull();
    expect(
      matchFollower(follower({ name: "Tom Keller", description: "Acme" }), [
        contact(acme),
      ]),
    ).toBeNull();
    expect(
      matchFollower(follower({ description: "Acme" }), [
        contact(acme),
        contact({ ...acme, id: "c2" }),
      ]),
    ).toBeNull();
  });
});
