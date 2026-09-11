import {
  Box,
  render as defaultRender,
  type RenderOptions,
  Text,
  useInput,
} from "ink";
import React, { useState } from "react";
import { TUI_THEME } from "./theme.js";

export type UpdatePromptAnswer = "y" | "n";
export interface InkPromptInstance {
  cleanup(): void;
  unmount(): void;
}

export type InkPromptRenderer = (
  node: React.ReactNode,
  options?: RenderOptions,
) => InkPromptInstance;

function UpdatePrompt({
  message,
  onAnswer,
}: {
  message: string;
  onAnswer: (answer: UpdatePromptAnswer) => void;
}): React.ReactElement {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (input === "\u0003" || (key.ctrl && input.toLowerCase() === "c")) {
      onAnswer("n");
      return;
    }
    if (key.upArrow || key.leftArrow) {
      setSelected(0);
      return;
    }
    if (key.downArrow || key.rightArrow) {
      setSelected(1);
      return;
    }
    if (key.return) {
      onAnswer(selected === 0 ? "y" : "n");
      return;
    }
    const normalizedInput = input.trim().toLowerCase();
    if (normalizedInput === "y" || normalizedInput === "yes") {
      onAnswer("y");
      return;
    }
    if (normalizedInput === "n" || normalizedInput === "q" || key.escape) {
      onAnswer("n");
    }
  });

  return React.createElement(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      paddingX: 1,
      paddingY: 1,
    },
    React.createElement(Text, { bold: true }, "Update available"),
    React.createElement(Text, { color: TUI_THEME.foreground }, message),
    React.createElement(
      Text,
      { color: selected === 0 ? TUI_THEME.accent : undefined },
      `${selected === 0 ? "›" : " "} Update now`,
    ),
    React.createElement(
      Text,
      { color: selected === 1 ? TUI_THEME.accent : undefined },
      `${selected === 1 ? "›" : " "} Continue without updating`,
    ),
    React.createElement(
      Text,
      { dimColor: true },
      "Use arrows, then Enter · Esc/q cancels",
    ),
  );
}

export function promptForUpdateWithInk(
  message: string,
  {
    render = defaultRender,
    stdin = process.stdin,
    stdout = process.stdout,
  }: {
    render?: InkPromptRenderer;
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
  } = {},
): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let settled = false;
  let instance: InkPromptInstance | undefined;
  const finish = (answer: UpdatePromptAnswer): void => {
    if (settled) return;
    settled = true;
    instance?.unmount();
    instance?.cleanup();
    resolve(answer);
  };
  instance = render(
    React.createElement(UpdatePrompt, { message, onAnswer: finish }),
    {
      stdin,
      stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  return promise;
}
