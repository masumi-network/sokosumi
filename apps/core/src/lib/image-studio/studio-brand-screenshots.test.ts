import { mkdir, writeFile } from "node:fs/promises";

import sharp from "sharp";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/lib/image-studio/product-import", () => ({}));
vi.mock("@/lib/image-studio/website-brand-profile", () => ({}));
vi.mock("@/lib/brand-visual", () => ({}));
vi.mock("@/lib/site-icon", () => ({}));

import { applyStudioBrandPrompt } from "./studio-brand";

const OUTPUT_DIR = new URL(
  "../../../../web/docs/images/studio-brand-prompt/",
  import.meta.url,
);
const FONT_FILE = "/System/Library/Fonts/Supplemental/Arial.ttf";
const BRIEF = [
  "Create a calm product ad for Fieldwork's handmade ceramic mug.",
  "Use a single mug on a warm white background with generous space.",
  "Headline: Made for everyday rituals.",
].join("\n");

function escapeMarkup(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

async function renderPrompt(name: string, prompt: string) {
  const text = await sharp({
    text: {
      text: `<span foreground="#1c1917">${escapeMarkup(prompt)}</span>`,
      font: "Arial 26",
      fontfile: FONT_FILE,
      width: 1040,
      spacing: 12,
      rgba: true,
    },
  })
    .png()
    .toBuffer();
  const frame =
    Buffer.from(`<svg width="1200" height="1000" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="1000" fill="#f5f5f4"/>
    <text x="64" y="94" font-family="Arial" font-size="44" font-weight="700" fill="#1c1917">${name}</text>
    <text x="64" y="138" font-family="Arial" font-size="22" fill="#57534e">Example project brand: #A33421 · Inter</text>
    <text x="64" y="198" font-family="Arial" font-size="18" font-weight="700" fill="#57534e">PROMPT SENT TO THE IMAGE MODEL</text>
    <rect x="48" y="222" width="1104" height="680" rx="12" fill="#ffffff" stroke="#d6d3d1"/>
    <text x="64" y="952" font-family="Arial" font-size="20" fill="#57534e">The stored job prompt remains the same brief.</text>
  </svg>`);
  const image = await sharp(frame)
    .composite([{ input: text, left: 80, top: 254 }])
    .png()
    .toBuffer();
  expect(await sharp(image).metadata()).toMatchObject({
    format: "png",
    width: 1200,
    height: 1000,
  });
  await writeFile(new URL(`${name.toLowerCase()}.png`, OUTPUT_DIR), image);
}

// Regenerate locally: UPDATE_STUDIO_BRAND_SCREENSHOTS=1 pnpm --filter core exec vitest run src/lib/image-studio/studio-brand-screenshots.test.ts
it.skipIf(process.env.UPDATE_STUDIO_BRAND_SCREENSHOTS !== "1")(
  "renders the same brief before and after structured brand injection",
  async () => {
    const after = applyStudioBrandPrompt(BRIEF, {
      designMd: null,
      memory: null,
      brandBrain: null,
      look: { colors: ["#A33421"], fonts: ["Inter"] },
    });
    expect(after).toContain("Palette: #A33421");
    expect(after).toContain("Fonts: Inter");
    expect(after.endsWith(`Brief:\n${BRIEF}`)).toBe(true);
    await mkdir(OUTPUT_DIR, { recursive: true });
    await renderPrompt("Before", BRIEF);
    await renderPrompt("After", after);
  },
);
