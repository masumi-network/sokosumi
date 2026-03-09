import { mapDbCoworkerToChatCoworker } from "../coworker-utils";

describe("mapDbCoworkerToChatCoworker", () => {
  it("keeps the coworker slug on the chat shape", () => {
    expect(
      mapDbCoworkerToChatCoworker({
        id: "cow_123",
        slug: "elena",
        name: "Elena",
        description: "Ops helper",
        image: null,
        caption: null,
        url: null,
        email: null,
        createdAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      }),
    ).toMatchObject({
      id: "cow_123",
      slug: "elena",
      name: "Elena",
      description: "Ops helper",
      useCase: "",
    });
  });
});
