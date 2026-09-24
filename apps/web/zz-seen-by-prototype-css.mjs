// PROTOTYPE — throwaway. Compiles the app's CSS and wraps the vitest dump in a page.
import { readFileSync, writeFileSync } from "node:fs";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

const ROOT = new URL(".", import.meta.url).pathname;
const [body, out] = process.argv.slice(2);
const css = `${ROOT}src/app/globals.css`;
const compiled = await postcss([tailwind()]).process(
  readFileSync(css, "utf8"),
  {
    from: css,
    to: out,
  },
);

writeFileSync(
  out,
  `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Read-by popover variants</title>
<style>${compiled.css}</style>
</head>
<body class="bg-muted/40 text-foreground font-sans antialiased">
<div class="mx-auto max-w-6xl px-6 pt-6">
<h1 class="text-lg font-semibold">Read-by popover: 4 variants</h1>
<p class="text-muted-foreground text-sm">Same data in each: 3 read, 3 not yet. Prototype, real app CSS and the real current component.</p>
</div>
${readFileSync(body, "utf8")}
</body>
</html>`,
);
