import type { SokoBotVersion } from "./types.js";
import { v25 } from "./v25.js";

export const v26: SokoBotVersion = {
  ...v25,
  id: "v26",
  name: "v26 · Coding with tools",
  createdAt: "2026-10-21",
  summary:
    "v25 that writes a script for repetitive tool work — paging years of mail, every row of a table — and keeps its own judgment for what the script finds.",
  releaseNote:
    "For big jobs like going through years of mail, I now write a small script that pages through everything, instead of searching by hand and missing months. I still judge what it finds myself.",
  skills: [...v25.skills, "code-tools"],
};
