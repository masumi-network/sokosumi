import { describe, expect, it } from "vitest";
import { parseSignature, readSignature } from "./contact-signature";

describe("signatures", () => {
  it("ignores the quoted reply, so the owner's own signature never sticks", () => {
    expect(
      parseSignature(
        "Thanks!\n\nOn Mon, Patrick wrote:\n> Patrick Tobler\n> CEO, Yellowhouse GmbH",
        "Patrick Tobler",
      ),
    ).toEqual({});
  });

  it("needs a title word before it calls a line a role", () => {
    expect(
      parseSignature("Cheers\nNina Keller\nZurich, Switzerland", "Nina Keller"),
    ).toEqual({});
    expect(
      parseSignature(
        "Best\nTom Berger\nCTO at Acme Robotics\n+41 44 000 00 00",
        "Tom Berger",
      ),
    ).toEqual({
      role: "CTO",
      organization: "Acme Robotics",
      phone: "+41 44 000 00 00",
    });
  });
});

describe("readSignature", () => {
  it("reads a pasted signature after the sign-off", () => {
    expect(
      readSignature(
        "Best regards,\n\nTom Berger\nCTO at Acme Robotics\n+41 44 000 00 00\ntom@acme.example\nlinkedin.com/in/tomberger",
      ),
    ).toEqual({
      name: "Tom Berger",
      role: "CTO",
      organization: "Acme Robotics",
      email: "tom@acme.example",
      phone: "+41 44 000 00 00",
      linkedIn: "https://www.linkedin.com/in/tomberger",
    });
  });

  it("takes the company from the next line and skips German sign-offs", () => {
    expect(
      readSignature(
        "Viele Grüße\nNina Keller\nHead of Marketing\nKeller Labs GmbH",
      ),
    ).toEqual({
      name: "Nina Keller",
      role: "Head of Marketing",
      organization: "Keller Labs GmbH",
    });
  });

  it("guesses nothing it cannot read", () => {
    expect(readSignature("")).toEqual({});
    expect(readSignature("Thanks!\n> Tom Berger\n> CTO, Acme")).toEqual({});
    expect(readSignature("call me: 0044 20 7946 0000")).toEqual({
      phone: "0044 20 7946 0000",
    });
  });
});
