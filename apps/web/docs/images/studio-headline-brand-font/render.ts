import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";
import type { renderStudioHeadline } from "@/app/projects/components/image-studio/studio-ad-headline";

const HEADLINE = "Crafted for everyday rituals.";
const FONT_CACHE = join(tmpdir(), "sokosumi-headline-playfair-display-700.ttf");

let font: Buffer;
try {
  font = await readFile(FONT_CACHE);
} catch {
  const cssResponse = await fetch(
    `https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&text=${encodeURIComponent(HEADLINE)}`,
  );
  assert(cssResponse.ok, "Google Fonts stylesheet must load");
  const fontUrl = (await cssResponse.text()).match(/url\((https:[^)]+)\)/)?.[1];
  assert(fontUrl, "Google Fonts must return a font file");
  assert.equal(new URL(fontUrl).hostname, "fonts.gstatic.com");
  const fontResponse = await fetch(fontUrl);
  assert(fontResponse.ok, "Playfair Display font must load");
  font = Buffer.from(await fontResponse.arrayBuffer());
  await writeFile(FONT_CACHE, font);
}

const source = stripTypeScriptTypes(
  await readFile(
    new URL(
      "../../../src/app/(app)/projects/components/image-studio/studio-ad-headline.ts",
      import.meta.url,
    ),
    "utf8",
  ),
);
const browser = await puppeteer.launch({
  executablePath: process.argv[2],
  headless: true,
  args: ["--disable-gpu", "--font-render-hinting=none"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>
    :root { --media-ground: #000000; --on-media: hsla(0, 0%, 100%, 1); }
  </style>`);
  const images = await page.evaluate(
    async ({ rendererSource, fontDataUrl, headline }) => {
      const moduleUrl = URL.createObjectURL(
        new Blob([rendererSource], { type: "text/javascript" }),
      );
      const render: typeof renderStudioHeadline = (
        await import(/* @vite-ignore */ moduleUrl)
      ).renderStudioHeadline;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 900;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Fixture canvas is unavailable");
      context.fillStyle = "#E4CDB2";
      context.fillRect(0, 0, 900, 900);
      context.fillStyle = "#D2B392";
      context.fillRect(0, 590, 900, 310);
      context.fillStyle = "#F8EDDF";
      context.fillRect(482, 650, 330, 250);
      context.fillStyle = "#EBDAC4";
      for (let x = 500; x < 810; x += 24) {
        context.fillRect(x, 650, 5, 250);
      }
      context.fillStyle = "#A33421";
      context.beginPath();
      context.roundRect(508, 375, 276, 270, [82, 82, 42, 42]);
      context.fill();
      context.beginPath();
      context.ellipse(646, 390, 138, 42, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#6A2419";
      context.beginPath();
      context.ellipse(646, 388, 96, 22, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#C96843";
      context.fillRect(538, 440, 12, 135);
      context.fillStyle = "#A33421";
      context.font = "500 25px system-ui";
      context.fillText("atelier / objects for living", 36, 846);
      const image = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Fixture PNG could not be saved"));
        });
      });
      const fontUrl = URL.createObjectURL(
        await (await fetch(fontDataUrl)).blob(),
      );
      const before = await render(image, headline);
      const previousFontCount = document.fonts.size;
      const after = await render(image, headline, undefined, {
        colors: ["#A33421", "#F8EDDF"],
        fonts: ["Playfair Display"],
        fontUrl,
      });
      if (document.fonts.size <= previousFontCount) {
        throw new Error("The after image must load a real brand font");
      }
      async function base64(blob: Blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return btoa(
          Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
        );
      }
      URL.revokeObjectURL(moduleUrl);
      URL.revokeObjectURL(fontUrl);
      return { before: await base64(before), after: await base64(after) };
    },
    {
      rendererSource: source,
      fontDataUrl: `data:font/ttf;base64,${font.toString("base64")}`,
      headline: HEADLINE,
    },
  );
  assert.notEqual(images.before, images.after);
  for (const [name, data] of Object.entries(images)) {
    await writeFile(
      new URL(`${name}.png`, import.meta.url),
      Buffer.from(data, "base64"),
    );
  }
  console.log(
    "Rendered before.png and after.png with the shared headline renderer.",
  );
} finally {
  await browser.close();
}
