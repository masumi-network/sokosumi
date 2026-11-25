import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user crops a photo in Files for a Story: upload an invented wide PNG,
// open it, Crop for social, pick Story, save, and find the 9:16 copy next to
// the original. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

/** A 1600 x 900 PNG: a sky-to-sand gradient with a sun, made here. */
function syntheticPhoto(width = 1600, height = 900): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const sun = (x - width * 0.7) ** 2 + (y - height * 0.35) ** 2 < 120 ** 2;
      const t = y / height;
      const at = row + 1 + x * 3;
      rows[at] = sun ? 255 : Math.round(90 + 150 * t);
      rows[at + 1] = sun ? 200 : Math.round(150 + 60 * t);
      rows[at + 2] = sun ? 60 : Math.round(230 - 120 * t);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}crop-for-social-${size}-${step}.png`,
  });
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a new user crops a Files photo for a Story", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      const mailbox = await createMailbox();
      await page.goto(`${BASE_URL}/signup`);
      await page.getByLabel("Email").fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByLabel("First name").fill("E2E");
      await page.getByLabel("Last name").fill("Tester");
      await page
        .getByLabel("Code from the email")
        .fill(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      await page.goto(`${BASE_URL}/drive?view=workspace`);
      await page
        .getByRole("tab", { name: "Workspace", selected: true })
        .waitFor();
      await page
        .locator('input[type="file"]:not([webkitdirectory])')
        .first()
        .setInputFiles({
          name: "beach.png",
          mimeType: "image/png",
          buffer: syntheticPhoto(),
        });
      await page.getByRole("link", { name: "beach.png" }).click();
      await page
        .getByTestId("image-viewer")
        .getByRole("button", { name: "Crop for social" })
        .click();

      const crop = page.getByRole("dialog", { name: "Crop for social" });
      await crop.getByRole("radio", { name: /Story/ }).click();
      await crop.getByText("Saves beach-9x16.png, 506 × 900 px").waitFor();
      // A tap near the track's right end places the crop there, no drag.
      const position = crop.getByRole("slider", {
        name: "Crop position, left to right",
      });
      const track = await position.boundingBox();
      assert.ok(track);
      await position.click({
        position: { x: track.width * 0.8, y: track.height / 2 },
      });
      const placed = Number(await position.inputValue());
      assert.ok(placed > 60 && placed < 95, `crop placed at ${placed}`);
      // Dragging the frame on the photo moves it too; the slider follows.
      const photo = await crop
        .getByRole("img", { name: "beach.png" })
        .boundingBox();
      assert.ok(photo);
      const middle = photo.y + photo.height / 2;
      await page.mouse.move(photo.x + photo.width * 0.75, middle);
      await page.mouse.down();
      await page.mouse.move(photo.x + photo.width * 0.25, middle, {
        steps: 5,
      });
      await page.mouse.up();
      const dragged = Number(await position.inputValue());
      assert.ok(dragged < 20, `crop dragged to ${dragged}`);
      await shot(page, size, "1-crop");

      await crop.getByRole("button", { name: "Save copy" }).click();
      await page.getByText("Saved beach-9x16.png to Files").waitFor();
      await crop.waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "beach-9x16.png" }).waitFor();
      await page.getByRole("link", { name: "beach.png" }).waitFor();
      await shot(page, size, "2-saved");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
