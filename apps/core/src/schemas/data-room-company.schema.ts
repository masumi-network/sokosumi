import { z } from "@hono/zod-openapi";
import { normalizeDriveFolderPath } from "@sokosumi/utils";

const text = (max: number) => z.string().trim().max(max).optional();

const representativeSchema = z
  .object({
    name: text(200),
    email: text(320),
    address: text(1_000),
  })
  .openapi("DataRoomCompanyRepresentative");

/** The company behind a data room, as its Company page shows it. */
export const dataRoomCompanySchema = z
  .object({
    legalName: z.string().trim().min(1).max(200),
    legalForm: text(200),
    jurisdiction: text(300),
    registrationAuthority: text(300),
    registrationNumber: text(100),
    incorporated: text(200).openapi({
      description:
        'When it was formed, as the owner writes it, e.g. "2 November 2026".',
    }),
    registeredOffice: text(1_000),
    registeredAgent: text(300),
    businessAddress: text(1_000),
    contactEmail: text(320),
    /** GDPR Art. 27 representative in the EU. */
    euRepresentative: representativeSchema.optional(),
    ukRepresentative: representativeSchema.optional(),
    vatId: text(50),
    ein: text(20),
    authorizedShares: text(300),
    parValue: text(50),
    websites: z.array(z.string().trim().max(300)).max(10).optional(),
    formationPath: text(1_000).openapi({
      description:
        'Folder of the formation documents, relative to the room, e.g. "Legal/Formation".',
    }),
  })
  .openapi("DataRoomCompany");

export type DataRoomCompany = z.infer<typeof dataRoomCompanySchema>;
type Representative = z.infer<typeof representativeSchema>;

function cleanRepresentative(
  person: Representative | undefined,
): Representative | undefined {
  if (!person?.name) return undefined;
  return dropEmpty(person);
}

function dropEmpty<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, field]) =>
        field !== undefined &&
        field !== "" &&
        !(Array.isArray(field) && field.length === 0),
    ),
  ) as T;
}

/** What is stored: empty fields dropped, a representative only with a name. */
export function cleanDataRoomCompany(
  company: DataRoomCompany,
): DataRoomCompany {
  return dropEmpty({
    ...company,
    euRepresentative: cleanRepresentative(company.euRepresentative),
    ukRepresentative: cleanRepresentative(company.ukRepresentative),
    websites: company.websites?.filter(Boolean),
    formationPath: company.formationPath
      ? normalizeDriveFolderPath(company.formationPath)
      : undefined,
  });
}

/** The stored details, or null when there are none or they no longer parse. */
export function readDataRoomCompany(stored: unknown): DataRoomCompany | null {
  if (stored === null || stored === undefined) return null;
  const parsed = dataRoomCompanySchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
