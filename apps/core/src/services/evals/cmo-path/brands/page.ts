import type { CmoPathPage } from "../types";

/** A plain HTML page in the brand's look: its colours and font in CSS. */
export function page(
  path: string,
  title: string,
  style: { primary: string; accent: string; ink: string; font: string },
  body: readonly string[],
): CmoPathPage {
  return {
    path,
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/logo.svg">
<style>:root{--brand:${style.primary};--accent:${style.accent};--ink:${style.ink}}
body{margin:0;font-family:${style.font};color:var(--ink);background:#fff}
header{background:var(--brand);color:#fff;padding:16px 32px;display:flex;gap:16px;align-items:center}
header img{height:32px}main{max-width:760px;margin:32px auto;padding:0 16px;line-height:1.6}
a{color:var(--brand)}h1{font-size:40px}blockquote{border-left:4px solid var(--accent);padding-left:12px}
.cta{background:var(--accent);color:var(--ink);padding:12px 20px;border-radius:8px;display:inline-block}</style></head>
<body><header><img src="/logo.svg" alt="logo"><nav><a style="color:#fff" href="/">Home</a> · <a style="color:#fff" href="/pricing">Pricing</a> · <a style="color:#fff" href="/about">About</a></nav></header>
<main>${body.join("\n")}<p><a class="cta" href="/pricing">Start free</a></p></main></body></html>`,
  };
}
