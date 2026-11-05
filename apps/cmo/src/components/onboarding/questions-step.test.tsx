// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { QuestionCard, useAnswers } from "./questions-step";

const QUESTION = {
  id: "households",
  question: "Are households your largest customer group?",
};

function Card({ save }: { save: () => Promise<void> }) {
  const [[question], answer] = useAnswers([QUESTION], save);
  return (
    <QuestionCard
      question={question as typeof QUESTION}
      label="Target customers"
      number={1}
      onAnswer={(value, note) => answer(QUESTION.id, value, note)}
    />
  );
}

async function render(save: () => Promise<void>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Card save={save} />));
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    ) as HTMLButtonElement;
  return {
    container,
    button,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("shows a tapped answer at once, before the save returns", async () => {
  let finish = () => {};
  const view = await render(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  try {
    await act(async () => view.button("Yes").click());
    expect(view.button("Yes").getAttribute("aria-pressed")).toBe("true");
    expect(view.button("No").disabled).toBe(false);
    await act(async () => finish());
  } finally {
    await view.cleanup();
  }
});

it("takes the answer back and says so when the save fails", async () => {
  let fail = () => {};
  const view = await render(
    () => new Promise<void>((_, reject) => (fail = () => reject(new Error()))),
  );
  try {
    await act(async () => view.button("Not sure").click());
    expect(view.button("Not sure").getAttribute("aria-pressed")).toBe("true");
    await act(async () => fail());
    expect(view.button("Not sure").getAttribute("aria-pressed")).toBe("false");
    expect(view.container.textContent).toContain("That didn't save.");
  } finally {
    await view.cleanup();
  }
});
