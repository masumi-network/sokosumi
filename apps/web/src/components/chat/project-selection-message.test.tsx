import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import {
  ProjectSelectionMessage,
  readProjectSelectionReply,
} from "./project-selection-message";

const id = "01a09b66-77dd-740e-889e-d4ed60b6007b";
const reply = `Use project "albina" (project ID: ${id}).`;
describe("project selection reply presentation", () => {
  it("shows a project avatar and linked name without exposing the raw ID as text", () => {
    const project = readProjectSelectionReply(reply);
    expect(project).toEqual({ id, name: "albina" });
    if (!project) throw new Error("Missing project");
    const html = renderToStaticMarkup(
      <ProjectSelectionMessage project={project} />,
    );
    expect(html).toContain(`href="/projects/${id}"`);
    expect(html).toContain('data-testid="project-avatar"');
    expect(html).toContain("albina");
    expect(html).not.toContain("project ID:");
    expect(html).not.toContain("Use project");
  });
  it("hides continuation context in the personal timeline while preserving the selected project", () => {
    expect(
      readProjectSelectionReply(
        `Continue this request: "Generate a book"\nYour question: "Which project?"\n${reply}`,
      ),
    ).toEqual({ id, name: "albina" });
  });
  it("decodes escaped project names as text", () => {
    const name = 'Books "A" [Launch] <script>\nIdeas';
    const project = readProjectSelectionReply(
      `Use project ${JSON.stringify(name)} (project ID: ${id}).`,
    );
    expect(project?.name).toBe(name);
    if (!project) throw new Error("Missing project");
    expect(
      renderToStaticMarkup(<ProjectSelectionMessage project={project} />),
    ).not.toContain("<script>");
  });
  it.each([
    "A normal chat message",
    `${reply}\nMore text`,
    `More text\n${reply}`,
    `Continue this request: not-json\nYour question: "Which?"\n${reply}`,
    `Use project "albina" (project ID: https://evil.test).`,
    `Use project "" (project ID: ${id}).`,
  ])("leaves ordinary or malformed messages untouched: %s", (content) => {
    expect(readProjectSelectionReply(content)).toBeNull();
  });
});
