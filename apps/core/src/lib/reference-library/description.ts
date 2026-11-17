import { REFERENCE_KINDS, REFERENCE_PURPOSES } from "@sokosumi/soko-bot";
import { z } from "zod";

/** Reads each library image once; cheap, and sees images well enough to catalogue them. */
export const REFERENCE_DESCRIBE_MODEL = "anthropic/claude-haiku-5.5";

export const referenceDescriptionSchema = z.object({
  kind: z.enum(REFERENCE_KINDS),
  era: z
    .string()

    .describe(
      'The decade it looks like it was printed, e.g. "1950s", or "unknown".',
    ),
  description: z
    .string()

    .describe("One or two sentences: what it shows and how it is made."),
  subjects: z.array(z.string()),
  technique: z
    .string()

    .describe('How it is printed or drawn, e.g. "silkscreen, flat colour".'),
  layout: z
    .string()

    .describe(
      'The composition, e.g. "big central figure, headline across the top".',
    ),
  lettering: z
    .string()

    .describe('The type, e.g. "condensed slab serif, hand-lettered"; "none".'),
  palette: z.array(z.string()),
  mood: z.array(z.string()),
  suits: z
    .array(z.enum(REFERENCE_PURPOSES))

    .describe("What kind of post this style would carry well."),
  textAmount: z.enum(["none", "little", "lots"]),
  usable: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe(
      "How useful as a style reference: 1 blank, damaged or a page of text; 5 a striking, clear design.",
    ),
});

export type ReferenceDescription = z.infer<typeof referenceDescriptionSchema>;

const clip = (text: string, max: number) => text.trim().slice(0, max);

/**
 * The model writes freely (a length limit in the schema made it fail a third
 * of the time); the catalogue keeps each field short.
 */
export function clipDescription(
  description: ReferenceDescription,
): ReferenceDescription {
  return {
    ...description,
    era: clip(description.era, 20),
    description: clip(description.description, 400),
    subjects: description.subjects.slice(0, 6).map((item) => clip(item, 60)),
    technique: clip(description.technique, 120),
    layout: clip(description.layout, 200),
    lettering: clip(description.lettering, 120),
    palette: description.palette.slice(0, 6).map((item) => clip(item, 30)),
    mood: description.mood.slice(0, 4).map((item) => clip(item, 30)),
    suits: [...new Set(description.suits)].slice(0, 4),
  };
}
