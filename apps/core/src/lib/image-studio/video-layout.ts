import { VIDEO_SHAPE_FRAMES, type VideoShape } from "@sokosumi/utils";

interface Box {
  width: number;
  height: number;
}

/**
 * Where everything sits in one shape of video: the part the network's own
 * buttons and captions leave clear, the text sizes, and how a 9:16 presenter
 * clip, the brand's page and its pictures are fitted into the frame.
 */
export interface VideoLayout {
  frame: Box;
  /** The part of the frame no network overlay covers. */
  safe: { left: number; right: number; top: number; bottom: number };
  /** ASS font sizes. */
  text: {
    caption: number;
    hook: number;
    label: number;
    number: number;
    card: number;
  };
  /**
   * How a presenter clip (always 1080 x 1920) fills the frame: cropped from
   * `cameraTop` pixels down, where the head is, or, when the frame is wider
   * than tall, shown whole between blurred copies of itself.
   */
  camera: "crop" | "pillar";
  cameraTop: number;
  /** The presenter cut out over the brand's page. */
  overPage: {
    presenter: Box;
    /** ffmpeg overlay x for the presenter; they always stand on the bottom. */
    presenterX: string;
    page: Box;
    pageX: string;
  };
  /** A picture is drawn this large, about a tenth over the frame, to pan. */
  picturePan: Box;
  endCard: { logoCentre: number; textTop: number };
}

/**
 * TikTok's in-feed layout keeps this part of a 1080 x 1920 video clear of its
 * own caption, buttons and top bar (from TikTok's in-feed ad templates).
 */
const VERTICAL: VideoLayout = {
  frame: VIDEO_SHAPE_FRAMES["9:16"],
  safe: { left: 120, right: 960, top: 240, bottom: 1260 },
  text: { caption: 100, hook: 58, label: 80, number: 200, card: 64 },
  camera: "crop",
  cameraTop: 0,
  // At 800 x 1422 the head covered the site's headline (NMKR's hero ran to
  // y 940 to 1290 of a 1080-wide capture), so the presenter stands smaller,
  // below the page's first 1280 pixels.
  overPage: {
    presenter: { width: 540, height: 960 },
    presenterX: "(W-w)/2",
    page: { width: 810, height: 1440 },
    pageX: "(W-w)/2",
  },
  picturePan: { width: 1188, height: 2112 },
  endCard: { logoCentre: 800, textTop: 1010 },
};

export const VIDEO_LAYOUTS: Record<VideoShape, VideoLayout> = {
  "9:16": VERTICAL,
  // Instagram's grid shows the middle 3:4 of a 4:5 post: text stays inside it.
  "4:5": {
    frame: VIDEO_SHAPE_FRAMES["4:5"],
    safe: { left: 100, right: 980, top: 110, bottom: 1230 },
    text: { caption: 84, hook: 52, label: 68, number: 170, card: 56 },
    camera: "crop",
    cameraTop: 120,
    overPage: {
      presenter: { width: 450, height: 800 },
      presenterX: "(W-w)/2",
      page: { width: 810, height: 1012 },
      pageX: "(W-w)/2",
    },
    picturePan: { width: 1188, height: 1486 },
    endCard: { logoCentre: 560, textTop: 710 },
  },
  "1:1": {
    frame: VIDEO_SHAPE_FRAMES["1:1"],
    safe: { left: 100, right: 980, top: 90, bottom: 990 },
    text: { caption: 80, hook: 50, label: 64, number: 150, card: 54 },
    camera: "crop",
    cameraTop: 240,
    overPage: {
      presenter: { width: 360, height: 640 },
      presenterX: "(W-w)/2",
      page: { width: 810, height: 810 },
      pageX: "(W-w)/2",
    },
    picturePan: { width: 1188, height: 1188 },
    endCard: { logoCentre: 450, textTop: 600 },
  },
  // YouTube, LinkedIn and X on a desktop: no overlay, a margin for players.
  "16:9": {
    frame: VIDEO_SHAPE_FRAMES["16:9"],
    safe: { left: 120, right: 1800, top: 80, bottom: 990 },
    text: { caption: 76, hook: 52, label: 64, number: 150, card: 54 },
    camera: "pillar",
    cameraTop: 0,
    overPage: {
      presenter: { width: 540, height: 960 },
      presenterX: "W-w-100",
      page: { width: 1240, height: 1080 },
      pageX: "80",
    },
    picturePan: { width: 2112, height: 1188 },
    endCard: { logoCentre: 450, textTop: 640 },
  },
};
