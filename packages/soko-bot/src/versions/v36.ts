import type { SokoBotVersion } from "./types.js";
import { v34 } from "./v34.js";
import { v35 } from "./v35.js";

export const v36: SokoBotVersion = {
  ...v35,
  id: "v36",
  name: "v36 · Hand-offs and remembered answers",
  createdAt: "2026-11-21",
  summary:
    "v35 on v34's stronger model for hard work, that hands work over with a structured request (goal, deliverable, deadline, context and the Task or Project it is about), reads the reply's status and links, checks what it already knows before asking again, and saves lasting answers to memory with who said them and when.",
  releaseNote:
    "When I hand work to a Coworker or another assistant, I now say exactly what I need, by when and why, and tell you whether they finished, need something, or said no. I also remember what they told me, so I don't ask the same thing twice, and I think harder on hard work: background runs, hiring and complex requests run on a stronger model.",
  // On top of the default: v34's stronger model for hard work.
  strongModel: v34.strongModel,
  skills: v35.skills.map((skill) =>
    skill === "conversations" ? "conversations-handoffs" : skill,
  ),
};
