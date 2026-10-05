// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type { OrganizationFormState } from "../app/workspace-actions";
import { OrganizationSetup } from "./organization-setup";

// The mascot's separate suite covers WebGL. Keep asset downloads out of form tests.
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    async loadAsync() {
      throw new Error("No WebGL in form tests");
    }
  },
}));

it("asks for the organization's name and website, with Back to the choice", () => {
  const html = renderToStaticMarkup(
    <OrganizationSetup createOrganizationWorkspace={vi.fn()} />,
  );

  expect(html).toContain("<h1>Set up your organization.</h1>");
  expect(html).toMatch(
    /<label for="organization-name">Organization name<\/label><input id="organization-name" required="" minLength="2" maxLength="50" autoComplete="organization" name="name" value=""\/>/,
  );
  expect(html).toMatch(
    /<label for="organization-website">Website<\/label><input id="organization-website" required="" inputMode="url" autoComplete="url" aria-describedby="organization-website-hint" name="websiteUrl" value=""\/>/,
  );
  expect(html).toContain(
    '<p id="organization-website-hint" class="note">Your company&#x27;s website, like acme.com.</p>',
  );
  expect(html).toMatch(
    /<button class="button" type="submit"[^>]*><span class="button-label">Create organization<\/span><\/button>/,
  );
  expect(html).toContain(
    '<a class="button button-secondary" href="/">Back</a>',
  );
  expect(html).not.toContain('role="alert"');
});

it("shows errors by their fields and keeps what was typed", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const createOrganizationWorkspace = vi.fn(
    async (
      previous: OrganizationFormState,
      formData: FormData,
    ): Promise<OrganizationFormState> => ({
      attempt: previous.attempt + 1,
      name: String(formData.get("name")),
      websiteUrl: String(formData.get("websiteUrl")),
      errors: {
        websiteUrl: "Enter a website, like acme.com.",
        form: "That did not work. Try again.",
      },
    }),
  );
  await act(async () => {
    root.render(
      <OrganizationSetup
        createOrganizationWorkspace={createOrganizationWorkspace}
      />,
    );
  });

  const name = container.querySelector<HTMLInputElement>("#organization-name");
  const website = container.querySelector<HTMLInputElement>(
    "#organization-website",
  );
  if (!name || !website) throw new Error("The form has no fields");
  name.value = "Acme";
  website.value = "acme";
  const submit = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  await act(async () => submit?.click());

  const shownWebsite = container.querySelector<HTMLInputElement>(
    "#organization-website",
  );
  expect(shownWebsite?.value).toBe("acme");
  expect(shownWebsite?.getAttribute("aria-invalid")).toBe("true");
  expect(shownWebsite?.getAttribute("aria-describedby")).toBe(
    "organization-website-hint organization-website-error",
  );
  expect(
    container.querySelector("#organization-website-error")?.textContent,
  ).toBe("Enter a website, like acme.com.");
  expect(
    container.querySelector<HTMLInputElement>("#organization-name")?.value,
  ).toBe("Acme");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "That did not work. Try again.",
  );

  await act(async () => root.unmount());
  container.remove();
});
