import sharp from "sharp";

/**
 * Where a brand's real screen goes in a styled picture, as shares of its
 * width and height. Image models asked to redraw a screenshot cropped or
 * changed it (8 of 8 tries on cal.com's homepage, 2026-11-20), so the model
 * leaves this panel plain and Core places the screenshot itself. It stays
 * clear of the headline above it and the logo corner below it.
 */
export const SCREEN_PANEL = {
  left: 0.1,
  right: 0.9,
  top: 0.3,
  bottom: 0.76,
} as const;

/** The panel in words, for the image prompt. */
export const SCREEN_PANEL_WORDS = `from ${SCREEN_PANEL.left * 100}% to ${SCREEN_PANEL.right * 100}% of the width and ${SCREEN_PANEL.top * 100}% to ${SCREEN_PANEL.bottom * 100}% of the height`;

/** First screens' height per unit of width: Core's capture viewports. */
const PHONE_SCREEN = 844 / 390;
const DESKTOP_SCREEN = 900 / 1440;

/** The browser bar's height, as a share of the frame's width. */
const BAR = 0.06;

/**
 * The picture with the screenshot in a plain browser frame that fills the
 * panel: its first screen, scaled down whole, never redrawn.
 */
export async function placeScreen(
  picture: Uint8Array,
  screenshot: Uint8Array,
): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(picture).metadata();
  const shot = sharp(screenshot).rotate();
  const { width: shotWidth = 0, height: shotHeight = 0 } =
    await shot.metadata();
  if (!width || !height || !shotWidth || !shotHeight)
    return Buffer.from(picture);
  const box = {
    width: Math.round(width * (SCREEN_PANEL.right - SCREEN_PANEL.left)),
    height: Math.round(height * (SCREEN_PANEL.bottom - SCREEN_PANEL.top)),
  };
  const bar = Math.round(box.width * BAR);
  // A long page shows its first screen, as the capture's viewport saw it: a
  // phone's for a narrow capture, a desktop's for a wide one. Cut to the
  // panel's wide shape, a phone capture lost its headline.
  const screenShape = shotHeight > shotWidth ? PHONE_SCREEN : DESKTOP_SCREEN;
  const shownHeight = Math.min(shotHeight, Math.round(shotWidth * screenShape));
  const scale = Math.min(
    box.width / shotWidth,
    (box.height - bar) / shownHeight,
  );
  const screen = {
    width: Math.max(1, Math.round(shotWidth * scale)),
    height: Math.max(1, Math.round(shownHeight * scale)),
  };
  // The frame covers the whole panel, so nothing the model drew there shows
  // (it drew a browser window of its own behind Core's once).
  const frame = box;
  const left = Math.round(width * SCREEN_PANEL.left);
  const top = Math.round(height * SCREEN_PANEL.top);
  const screenLeft = left + Math.round((frame.width - screen.width) / 2);
  const screenTop =
    top + bar + Math.round((frame.height - bar - screen.height) / 2);
  const dot = Math.max(2, Math.round(bar * 0.16));
  const chrome = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}">` +
      `<rect x="0.5" y="0.5" width="${frame.width - 1}" height="${frame.height - 1}" rx="${Math.round(bar * 0.3)}" fill="#f3f3f3" stroke="#2b2b2b" stroke-opacity="0.35"/>` +
      [0, 1, 2]
        .map(
          (index) =>
            `<circle cx="${Math.round(bar * 0.5 + index * dot * 3)}" cy="${Math.round(bar / 2)}" r="${dot}" fill="#b5b5b5"/>`,
        )
        .join("") +
      "</svg>",
  );
  const shadow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}"><rect width="${frame.width}" height="${frame.height}" rx="${Math.round(bar * 0.3)}" fill="#000" fill-opacity="0.22"/></svg>`,
  );
  const blur = Math.max(1, Math.round(bar * 0.25));
  const shown = await shot
    .extract({ left: 0, top: 0, width: shotWidth, height: shownHeight })
    .resize(screen.width, screen.height)
    .toBuffer();
  return sharp(picture)
    .composite([
      {
        input: await sharp(shadow).blur(blur).png().toBuffer(),
        left: Math.min(width - frame.width, left + blur),
        top: Math.min(height - frame.height, top + blur),
      },
      { input: chrome, left, top },
      { input: shown, left: screenLeft, top: screenTop },
    ])
    .png()
    .toBuffer();
}
