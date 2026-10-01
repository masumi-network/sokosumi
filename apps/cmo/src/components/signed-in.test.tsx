import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { SignedIn } from "./signed-in";

it("shows the Sokosumi account's name and email with Sign out", () => {
  const html = renderToStaticMarkup(
    <SignedIn
      name="Ada Lovelace"
      email="ada@example.com"
      signOut={async () => {}}
    />,
  );

  expect(html).toContain("<p>Signed in as Ada Lovelace</p>");
  expect(html).toContain("ada@example.com");
  expect(html).toContain('<button type="submit">Sign out</button>');
});

it.each(["", "   ", "\t\n"])(
  "names the account by its email when its name is %j",
  (name) => {
    const html = renderToStaticMarkup(
      <SignedIn name={name} email="ada@example.com" signOut={async () => {}} />,
    );

    expect(html).toContain("<p>Signed in as ada@example.com</p>");
    expect(html.split("ada@example.com")).toHaveLength(2);
  },
);
