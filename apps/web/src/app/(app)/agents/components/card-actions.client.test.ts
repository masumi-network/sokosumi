import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

// A card button shows a short verb ("Give a task") and names its agent for
// screen readers. Speech-input users say what they see, so the name must
// contain the visible words (WCAG 2.5.3 Label in Name).
const PAIRS = [
  ["chat", "chatName"],
  ["giveTask", "giveTaskName"],
  ["startTask", "startTaskName"],
  ["message", "messageName"],
] as const;

describe.each([
  ["en", en],
  ["de", de],
  ["es", es],
])("card action names in %s", (locale, messages) => {
  const t = createTranslator({
    locale,
    messages,
    namespace: "App.Agents.Directory",
  });

  it.each(PAIRS)("%s is inside %s", (label, name) => {
    const visible = t(label).toLowerCase();
    expect(t(name, { name: "Hepha" }).toLowerCase()).toContain(visible);
  });
});
