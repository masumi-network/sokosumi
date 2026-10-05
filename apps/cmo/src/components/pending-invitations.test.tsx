// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { PendingInvitations } from "./pending-invitations";

// The mascot's separate suite covers WebGL. Keep asset downloads out of form tests.
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    async loadAsync() {
      throw new Error("No WebGL in form tests");
    }
  },
}));

function render(count: number) {
  return renderToStaticMarkup(
    <PendingInvitations
      count={count}
      sokosumiSetupUrl="https://app.sokosumi.com/setup"
      email="ada@example.com"
      signOut={async () => {}}
    />,
  );
}

it("tells a person about their invitation and where to accept it", () => {
  const html = render(1);

  expect(html).toContain("<h1>You have an invitation.</h1>");
  expect(html).toContain(
    '<p class="lead">Accept it on Sokosumi to use CMO with your team, or decline it. Then come back here.</p>',
  );
});

it("counts several invitations", () => {
  const html = render(3);

  expect(html).toContain("<h1>You have 3 invitations.</h1>");
  expect(html).toContain(
    '<p class="lead">Accept one on Sokosumi to use CMO with your team, or decline them. Then come back here.</p>',
  );
});

it("opens Sokosumi's workspace gate in a new tab, with the account to use", () => {
  const html = render(1);

  expect(html).toContain(
    '<a class="button" href="https://app.sokosumi.com/setup" target="_blank" rel="noopener noreferrer" aria-describedby="pending-invitations-new-tab">Open Sokosumi</a>',
  );
  expect(html).toContain(
    '<p id="pending-invitations-new-tab" class="note">Sokosumi opens in a new tab. Use your account ada@example.com there.</p>',
  );
});

it("offers Check again and Sign out, and no way to start a workspace", () => {
  const html = render(1);

  expect(html).toContain(
    '<a class="button button-secondary" href="/">Check again</a>',
  );
  expect(html).toMatch(
    /<button class="button button-secondary" type="submit"[^>]*><span class="button-label">Sign out<\/span><\/button>/,
  );
  expect(html).not.toContain("Just me");
  expect(html).not.toContain("step=organization");
});
