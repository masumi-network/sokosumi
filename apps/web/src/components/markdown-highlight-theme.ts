import {
  createThemeCss,
  type HighlightTheme,
  themeTokenClasses,
} from "@tanstack/highlight/theme";

const sokosumiHighlightTheme = {
  name: "sokosumi",
  type: "light",
  background: "transparent",
  foreground: "var(--foreground)",
  tokens: {
    token: "var(--foreground)",
    attr: "var(--tertiary-foreground)",
    "code-inline": "var(--foreground)",
    command: "var(--primary-iris)",
    comment: "var(--muted-foreground)",
    deleted: "var(--semantic-destructive)",
    function: "var(--primary-iris)",
    heading: "var(--primary-variant)",
    inserted: "var(--primary)",
    keyword: "var(--primary)",
    link: "var(--primary)",
    literal: "var(--tertiary-foreground)",
    meta: "var(--muted-foreground)",
    number: "var(--tertiary-foreground)",
    operator: "var(--primary-iris)",
    property: "var(--foreground)",
    selector: "var(--primary-variant)",
    string: "var(--primary-variant)",
    tag: "var(--primary-variant)",
    type: "var(--primary-iris)",
    variable: "var(--foreground)",
  },
} satisfies HighlightTheme;

const tokenColorRules = themeTokenClasses
  .map((token) => `.th-${token} { color: var(--th-${token}); }`)
  .join("\n");

export const markdownHighlightThemeCss = `${createThemeCss({
  light: sokosumiHighlightTheme,
  includeBaseStyles: false,
})}

${tokenColorRules}
.th-comment { font-style: italic; }`;
