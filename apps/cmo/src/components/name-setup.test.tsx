// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type { NameFormState } from "../app/name-actions";
import { NameSetup } from "./name-setup";

// The mascot's separate suite covers WebGL. Keep asset downloads out of form tests.
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    async loadAsync() {
      throw new Error("No WebGL in form tests");
    }
  },
}));

it("asks for the first and last name, with Sign out", () => {
  const html = renderToStaticMarkup(
    <NameSetup saveName={vi.fn()} signOut={vi.fn()} />,
  );

  expect(html).toContain("<h1>What is your name?</h1>");
  expect(html).toMatch(
    /<label for="first-name">First name<\/label><input id="first-name" required="" autoComplete="given-name" name="firstName" value=""\/>/,
  );
  expect(html).toMatch(
    /<label for="last-name">Last name<\/label><input id="last-name" required="" autoComplete="family-name" name="lastName" value=""\/>/,
  );
  expect(html).toMatch(
    /<button class="button" type="submit"[^>]*><span class="button-label">Continue<\/span><\/button>/,
  );
  expect(html).not.toMatch(
    /<button class="button" type="submit" formNoValidate/,
  );
  expect(html).toMatch(
    /<button class="button button-secondary" type="submit" formNoValidate=""[^>]*><span class="button-label">Sign out<\/span><\/button>/,
  );
  expect(html).not.toContain('role="alert"');
});

it("shows errors by their fields and keeps what was typed", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const saveName = vi.fn(
    async (
      previous: NameFormState,
      formData: FormData,
    ): Promise<NameFormState> => ({
      attempt: previous.attempt + 1,
      firstName: String(formData.get("firstName")),
      lastName: String(formData.get("lastName")),
      errors: {
        lastName: "Enter your last name.",
        form: "That did not work. Try again.",
      },
    }),
  );
  await act(async () => {
    root.render(<NameSetup saveName={saveName} signOut={vi.fn()} />);
  });

  const firstName = container.querySelector<HTMLInputElement>("#first-name");
  const lastName = container.querySelector<HTMLInputElement>("#last-name");
  if (!firstName || !lastName) throw new Error("The form has no fields");
  firstName.value = "Ada";
  // Blank passes `required`; the action's rule catches it.
  lastName.value = " ";
  const submit = [
    ...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  ].find((button) => button.textContent === "Continue");
  await act(async () => submit?.click());

  expect(saveName).toHaveBeenCalledOnce();
  const shownLastName = container.querySelector<HTMLInputElement>("#last-name");
  // Focus moves to the first field to fix, which reads out its error.
  expect(document.activeElement).toBe(shownLastName);
  expect(shownLastName?.getAttribute("aria-invalid")).toBe("true");
  expect(shownLastName?.getAttribute("aria-describedby")).toBe(
    "last-name-error",
  );
  expect(container.querySelector("#last-name-error")?.textContent).toBe(
    "Enter your last name.",
  );
  expect(container.querySelector<HTMLInputElement>("#first-name")?.value).toBe(
    "Ada",
  );
  expect(container.querySelector('form [role="alert"]')?.textContent).toBe(
    "That did not work. Try again.",
  );

  await act(async () => root.unmount());
  container.remove();
});

it("moves focus to the alert when the save failed as a whole", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const saveName = vi.fn(
    async (previous: NameFormState): Promise<NameFormState> => ({
      attempt: previous.attempt + 1,
      firstName: "Ada",
      lastName: "Lovelace",
      errors: { form: "That did not work. Try again." },
    }),
  );
  await act(async () => {
    root.render(<NameSetup saveName={saveName} signOut={vi.fn()} />);
  });
  for (const id of ["#first-name", "#last-name"]) {
    const field = container.querySelector<HTMLInputElement>(id);
    if (field) field.value = "Ada";
  }
  const submit = [
    ...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  ].find((button) => button.textContent === "Continue");
  await act(async () => submit?.click());

  expect(document.activeElement).toBe(
    container.querySelector('form [role="alert"]'),
  );

  await act(async () => root.unmount());
  container.remove();
});

it("signs out from the empty form", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const signOut = vi.fn();
  await act(async () => {
    root.render(<NameSetup saveName={vi.fn()} signOut={signOut} />);
  });
  const signOutButton = [
    ...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  ].find((button) => button.textContent === "Sign out");
  await act(async () => signOutButton?.click());

  expect(signOut).toHaveBeenCalledOnce();

  await act(async () => root.unmount());
  container.remove();
});

it("disables both buttons while saving and spins only Continue", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const saveName = vi.fn(() => new Promise<NameFormState>(() => {}));
  await act(async () => {
    root.render(<NameSetup saveName={saveName} signOut={vi.fn()} />);
  });
  for (const id of ["#first-name", "#last-name"]) {
    const field = container.querySelector<HTMLInputElement>(id);
    if (field) field.value = "Ada";
  }
  const [continueButton, signOutButton] = [
    ...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  ];
  await act(async () => continueButton?.click());

  expect(continueButton?.textContent).toBe("Continue");
  expect(continueButton?.getAttribute("aria-busy")).toBe("true");
  expect(signOutButton?.disabled).toBe(true);
  expect(signOutButton?.hasAttribute("aria-busy")).toBe(false);

  await act(async () => root.unmount());
  container.remove();
});
