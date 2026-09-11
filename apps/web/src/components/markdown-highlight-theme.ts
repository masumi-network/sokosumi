import { createThemeCss, themeTokenClasses } from "@tanstack/highlight/theme";
import { githubDarkTheme } from "@tanstack/highlight/themes/github-dark";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";

const tokenColorRules = themeTokenClasses
  .map((token) => `pre.th-code .th-${token} { color: var(--th-${token}); }`)
  .join("\n");

/**
 * GitHub token colors via createThemeCss. Surface fill stays on the Markdown
 * `prose-pre:bg-muted/40` chrome — `--th-background` is transparent so the
 * shipped #fff / #0d1117 fills do not paint a foreign island.
 */
export const markdownHighlightThemeCss = `${createThemeCss({
  light: githubLightTheme,
  dark: githubDarkTheme,
  lightSelector: "pre.th-code",
  darkSelector: ".dark pre.th-code",
  includeBaseStyles: false,
})}

pre.th-code,
.dark pre.th-code {
  --th-background: transparent;
  color: var(--th-token);
}

${tokenColorRules}
pre.th-code .th-comment { font-style: italic; }
`;
