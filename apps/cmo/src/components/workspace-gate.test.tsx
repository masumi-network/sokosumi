// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { WorkspaceGate } from "./workspace-gate";

// The mascot's separate suite covers WebGL. Keep asset downloads out of form tests.
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    async loadAsync() {
      throw new Error("No WebGL in form tests");
    }
  },
}));

function render(failed = false) {
  return renderToStaticMarkup(
    <WorkspaceGate
      failed={failed}
      createPersonalWorkspace={async () => {}}
      signOut={async () => {}}
    />,
  );
}

it("asks where the person will use CMO, with Just me and Sign out", () => {
  const html = render();

  expect(html).toContain("<h1>Where will you use CMO?</h1>");
  expect(html).toMatch(
    /<button class="choice" type="submit"[^>]*><span class="button-label"><span class="choice-title">Just me<\/span><span class="choice-detail">A personal workspace for you alone\.<\/span><\/span><\/button>/,
  );
  expect(html).toMatch(
    /<button class="button button-secondary" type="submit"[^>]*><span class="button-label">Sign out<\/span><\/button>/,
  );
  expect(html).not.toContain('role="alert"');
});

it("shows My organization as coming soon, not yet choosable", () => {
  expect(render()).toMatch(
    /<button class="choice" type="button" disabled=""><span class="choice-title">My organization<\/span><span class="choice-detail">A shared workspace for your team\. Coming soon\.<\/span><\/button>/,
  );
});

it("says the last choice did not work", () => {
  expect(render(true)).toContain(
    '<p role="alert">That did not work. Try again.</p>',
  );
});
