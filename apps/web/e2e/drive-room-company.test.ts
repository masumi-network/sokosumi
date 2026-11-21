import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's Files path, end to end: make a folder, upload an invented CSV
// and preview it, turn the folder into a data room, copy its link, fill its
// Company tab, then search a
// Files Table with Find and replace from the keyboard. Each size signs up its
// own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const CSV = ["Item,Price", "Sourdough,6.50", "Rye loaf,5.80"].join("\n");
// Long enough to scroll a preview. PRICES_CSV has a blank third label;
// NOTES_CSV a first label of three long lines that wrap: short enough to pin
// at normal size, too tall once the window shrinks and the text is enlarged.
const ROWS = Array.from(
  { length: 60 },
  (_, i) => `Bread ${i + 1},${i + 1}.50,x`,
);
const PRICES_CSV = ["Item,Price,", ...ROWS].join("\n");
const WRAP_LABEL = Array.from({ length: 3 }, () => "W ".repeat(19) + "W").join(
  "\n",
);
const NOTES_CSV = [`"${WRAP_LABEL}",Price,Note`, ...ROWS].join("\n");

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

/**
 * Scrolls the CSV preview holding the "Price" header 600px and reports where
 * its header row ends up against the scrollport.
 */
async function scrollPreview(page: Page) {
  const price = page.getByRole("columnheader", { name: "Price" });
  await price.waitFor();
  return price.evaluate(async (th) => {
    const scroller = th.closest("table")?.parentElement as HTMLElement;
    const firstRow = scroller.querySelector("tbody tr") as HTMLElement;
    const firstHead = th.parentElement?.firstElementChild as HTMLElement;
    const top = () => scroller.getBoundingClientRect().top;
    // A few frames for a resize to reach the observer and re-render.
    const settle = () =>
      new Promise((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
      );
    scroller.scrollTop = 0;
    await settle();
    scroller.scrollTop = 600;
    await settle();
    const head = th.getBoundingClientRect();
    // Geometry inside the scrollport, not a hit test, so page chrome above
    // the preview or a page scrolled off it cannot change the answer.
    const port = scroller.getBoundingClientRect();
    const headerEnd = Math.min(Math.max(head.bottom, port.top), port.bottom);
    const rows = [...scroller.querySelectorAll("tbody tr")];
    return {
      scrolled: scroller.scrollTop > 0,
      // Rows show in the scrollport below whatever the header still covers.
      bodyAtFoot:
        headerEnd < port.bottom &&
        rows.some((row) => {
          const box = row.getBoundingClientRect();
          return box.top < port.bottom && box.bottom > headerEnd;
        }),
      headerAtTop: Math.abs(head.top - top()) <= 1,
      headerScrolledAway: head.bottom <= top(),
      firstRowUnderHeader:
        firstRow.getBoundingClientRect().bottom <= head.bottom,
      // Nothing in the first label is cut off from sight.
      firstLabelWhole: firstHead.scrollHeight <= firstHead.clientHeight,
      firstLabel: firstHead.innerText,
    };
  });
}

/** The header stays pinned over the rows and its first label reads whole. */
async function expectPinnedHeader(page: Page, firstLabel: string) {
  assert.deepEqual(await scrollPreview(page), {
    scrolled: true,
    bodyAtFoot: true,
    headerAtTop: true,
    headerScrolledAway: false,
    firstRowUnderHeader: true,
    firstLabelWhole: true,
    firstLabel,
  });
}

/** A header too tall to pin reads whole above the rows, then scrolls away. */
async function expectHeaderInFlow(page: Page, firstLabel: string) {
  assert.deepEqual(await scrollPreview(page), {
    scrolled: true,
    bodyAtFoot: true,
    headerAtTop: false,
    headerScrolledAway: true,
    // In the flow, the rows follow the header instead of passing under it.
    firstRowUnderHeader: false,
    firstLabelWhole: true,
    firstLabel,
  });
}

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({ path: `${RESULTS_DIR}drive-${size}-${step}.png` });
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
    test("a new user files a CSV, fills a data room's Company tab and searches a table by keyboard", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: BASE_URL,
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

      // A folder with one file in it.
      await page.goto(`${BASE_URL}/drive?view=workspace`);
      await page
        .getByRole("tab", { name: "Workspace", selected: true })
        .waitFor();
      await shot(page, size, "0-workspace");
      // The toolbar can take a click before it hydrates; try again until the dialog opens.
      const folderDialog = page.getByRole("dialog", {
        name: "Create new folder",
      });
      const more = page.getByRole("button", { name: "More actions" });
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await more.isVisible()) {
          await more.click();
          await page.getByRole("menuitem", { name: "New" }).click();
        } else {
          await page.getByRole("button", { name: "New", exact: true }).click();
        }
        if (
          await folderDialog
            .waitFor({ timeout: 3_000 })
            .then(() => true)
            .catch(() => false)
        )
          break;
      }
      await folderDialog.getByRole("textbox").fill("E2E launch");
      await page.keyboard.press("Enter");
      await page.waitForURL(/folder=E2E/);
      const folderUrl = page.url();
      await page
        .locator('input[type="file"]:not([webkitdirectory])')
        .setInputFiles({
          name: "prices.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(PRICES_CSV),
        });
      const fileLink = page.getByRole("link", { name: "prices.csv" });
      await fileLink.waitFor();
      await page
        .locator('input[type="file"]:not([webkitdirectory])')
        .setInputFiles({
          name: "notes.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(NOTES_CSV),
        });
      const notesLink = page.getByRole("link", { name: "notes.csv" });
      await notesLink.waitFor();
      const box = await fileLink.boundingBox();
      assert.ok(
        box && box.height >= 24,
        `file name link is ${box?.height}px tall`,
      );
      await shot(page, size, "1-folder");

      // Both CSV previews, the viewer and the file's own page, read the first
      // row as column headers that stay pinned while the rows scroll.
      await fileLink.click();
      await page.getByRole("columnheader", { name: "Column 3" }).waitFor();
      await expectPinnedHeader(page, "Item");
      await shot(page, size, "1b-csv-viewer");
      await page.getByRole("link", { name: "Details" }).click();
      await page.waitForURL(/\/drive\/files\//);
      await expectPinnedHeader(page, "Item");
      await shot(page, size, "1c-csv-file-page");
      await page.goto(folderUrl);

      // Pinning follows the header's rendered height: a wrapping label pins at
      // normal size, scrolls with the rows once a small window and 200% text
      // make it tall, and pins again when both are back. On the file's page,
      // so the resize closes no dialog.
      await notesLink.click();
      await page.getByRole("link", { name: "Details" }).click();
      await page.waitForURL(/\/drive\/files\//);
      await expectPinnedHeader(page, WRAP_LABEL);
      await page.setViewportSize({ width: 320, height: 256 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      await expectHeaderInFlow(page, WRAP_LABEL);
      await shot(page, size, "1d-csv-tall-header");
      await page.setViewportSize(viewport);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
      await expectPinnedHeader(page, WRAP_LABEL);
      await page.goto(folderUrl);

      // The folder becomes a data room; its Company tab checks emails.
      await page
        .getByRole("button", { name: "Data room for E2E launch" })
        .click();
      await page.getByRole("button", { name: "Make data room" }).click();
      await page.waitForURL(/\/drive\/data-rooms\//);
      // The header keeps the room name and privacy line whole; Copy link is
      // an icon on a phone and still copies the share link.
      const heading = page.getByRole("heading", { level: 1 });
      await heading.waitFor();
      const header = await heading.evaluate((h1) => {
        const line = h1.nextElementSibling as HTMLElement;
        return {
          name: h1.textContent,
          nameWhole: h1.scrollWidth <= h1.clientWidth,
          lineWhole: line.scrollWidth <= line.clientWidth,
        };
      });
      assert.deepEqual(header, {
        name: "E2E launch",
        nameWhole: true,
        lineWhole: true,
      });
      await page.getByRole("button", { name: "Copy link" }).click();
      await page.getByText("Link copied").first().waitFor();
      assert.match(
        await page.evaluate(() => navigator.clipboard.readText()),
        /\/share\/rooms\//,
      );
      await shot(page, size, "1e-room-header");
      await page.getByRole("tab", { name: "Company" }).click();
      const legalName = page.getByLabel("Legal name");
      const email = page.getByLabel("Legal contact email");
      const save = page.getByRole("button", { name: "Save company details" });
      const saved = page.getByText("Company details saved");
      await legalName.fill("E2E Bakery GmbH");
      await email.fill("legal-at-e2e");
      // The browser checks the form before it dispatches `submit`, so an
      // invalid email never fires it: no submit event means nothing was sent.
      await email.evaluate((field) => {
        const form = field.closest("form") as HTMLFormElement;
        form.dataset.submitted = "no";
        form.addEventListener("submit", () => {
          form.dataset.submitted = "yes";
        });
      });
      await save.click();
      const after = await email.evaluate((field) => {
        const label = document.querySelector(`label[for="${field.id}"]`);
        const visible = (element: Element | null) => {
          if (!element) return false;
          const { left, top, width, height } = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            left + width / 2,
            top + height / 2,
          );
          return top >= 0 && (hit === element || element.contains(hit));
        };
        return {
          invalid: field.matches(":invalid"),
          focused: document.activeElement === field,
          submitted: (field.closest("form") as HTMLFormElement).dataset
            .submitted,
          fieldVisible: visible(field),
          labelVisible: visible(label),
        };
      });
      assert.deepEqual(
        after,
        {
          invalid: true,
          focused: true,
          submitted: "no",
          fieldVisible: true,
          labelVisible: true,
        },
        "a malformed email is refused before submit, shown with its label",
      );
      await shot(page, size, "2-invalid-email");
      await email.fill("legal@e2e.example");
      await save.click();
      await saved.first().waitFor();
      await shot(page, size, "3-saved");

      // A Files Table, searched from the keyboard: the Find field keeps focus.
      await page.goto(`${BASE_URL}/drive?view=tables`);
      await page.getByRole("button", { name: "New table" }).click();
      const create = page.getByRole("dialog", { name: "New table" });
      await create.getByLabel("Title").fill("Price list");
      await create.locator('input[type="file"]').setInputFiles({
        name: "prices.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV),
      });
      await create.getByText("Map columns and preview").waitFor();
      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByText("Rye loaf", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Table options" }).click();
      await page.getByRole("menuitem", { name: "Find and replace" }).click();
      const dialog = page.getByRole("dialog", { name: "Find and replace" });
      const find = dialog.getByLabel("Find");
      await find.click();
      await page.keyboard.type("rye");
      await page.keyboard.press("Enter");
      await dialog.getByText("No cell in this column holds exactly").waitFor();
      await page.keyboard.type(" loaf");
      assert.equal(
        await find.inputValue(),
        "rye loaf",
        `typing after Enter landed in ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`,
      );
      await page.keyboard.press("Enter");
      await dialog.getByText("1 cell will change.").waitFor();
      await shot(page, size, "4-find-keyboard");
      await page.keyboard.press("Escape");

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await context.close();
      assert.equal(overflow, 0, `page overflows by ${overflow}px`);
      assert.deepEqual(errors, []);
    });
  });
}
