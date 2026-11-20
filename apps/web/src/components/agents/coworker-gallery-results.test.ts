import { expect, it } from "vitest";
import { mockCoreCoworker } from "@/test-fixtures/coworker";
import { groupCoworkerSearchResults } from "./coworker-gallery-results";

it("shows matching offers first and preserves all offers for a coworker name match", () => {
  const member = mockCoreCoworker({
    name: "Elaine",
    metadata: {
      channels: {},
      offers: [
        {
          title: "Strategy",
          description: "Website design projects",
          prompt: "Develop a strategy",
        },
        { title: "Design review", prompt: "Review the design" },
        { title: "Budget", prompt: "Draft a budget" },
      ],
    },
  });
  const named = mockCoreCoworker({ id: "second", name: "Design partner" });
  const [design] = groupCoworkerSearchResults([member, named], "design");
  expect(design?.offers.map(({ offer }) => offer.title)).toEqual([
    "Design review",
    "Strategy",
  ]);
  expect(design?.coworkers.map(({ name }) => name)).toEqual([
    "Elaine",
    "Design partner",
  ]);
  expect(
    groupCoworkerSearchResults([member], "Elaine")[0]?.offers,
  ).toHaveLength(3);
});
