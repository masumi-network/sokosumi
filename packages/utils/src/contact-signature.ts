/**
 * Reads the people facts a plain email signature states: title, company,
 * phone and LinkedIn. Shared by Core's mail capture and Web's Add contact.
 */

export interface Signature {
  role?: string;
  organization?: string;
  phone?: string;
  linkedIn?: string;
}

const QUOTE_START =
  /^(>|on .+wrote:?$|am .+schrieb.*:?$|le .+a écrit.*:?$|-{2,}\s*original message|-{2,}\s*ursprüngliche nachricht|from:\s|von:\s|sent from my )/i;

const TITLE_WORDS =
  /\b(ceo|cto|cfo|coo|cmo|cpo|ciso|vp|svp|evp|founder|co-founder|cofounder|owner|partner|managing director|director|head|lead|manager|president|chair|officer|engineer|developer|designer|consultant|analyst|associate|principal|specialist|coordinator|advisor|adviser|investor|architect|scientist|researcher|professor|recruiter|account executive|executive|editor|producer|geschäftsführer|geschäftsführerin|leiter|leiterin|gründer|gründerin|inhaber|inhaberin|berater|beraterin)\b/i;

const COMPANY_HINT =
  /\b(gmbh|ag|sa|sarl|s\.a\.|inc\.?|ltd\.?|llc|bv|b\.v\.|plc|oy|ab|as|kg|ug|labs?|ventures|capital|partners|group|holding|studio|technologies|solutions|systems|software|network|foundation|university|institute)\b/i;

const PHONE = /(?:^|[\s:])((?:\+|00)[1-9][\d\s().\/-]{6,20}\d)(?![\d])/;
const LINKEDIN = /linkedin\.com\/in\/([\p{L}\p{N}_\-%.]+)/iu;
const SPLIT_ROLE_ORG = /\s*(?:\||·|•|,|\bat\b|@|\s[-–—]\s)\s*/i;

/** The lines of the newest message, before any quoted reply. */
function ownLines(body: string): string[] {
  const lines: string[] = [];
  for (const line of body.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (QUOTE_START.test(trimmed)) break;
    if (trimmed) lines.push(trimmed);
  }
  return lines.slice(-15);
}

function cleanPart(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length <= 120 ? cleaned : undefined;
}

/**
 * Title, company, phone and LinkedIn from the signature of a message, when a
 * signature says so plainly. A title needs a title word; a company needs to
 * follow the title or look like one. Anything less is left to enrichment.
 */
export function parseSignature(
  body: string,
  senderName: string | null,
): Signature {
  const lines = ownLines(body);
  if (lines.length === 0) return {};
  const signature: Signature = {};
  const joined = lines.join("\n");
  const phone = PHONE.exec(joined)?.[1];
  if (phone) signature.phone = phone.replace(/\s+/g, " ").trim();
  const linkedIn = LINKEDIN.exec(joined)?.[1];
  if (linkedIn)
    signature.linkedIn = `https://www.linkedin.com/in/${linkedIn.replace(/[.)]+$/, "")}`;

  const first = senderName?.split(" ")[0]?.toLowerCase();
  const nameAt = senderName
    ? lines.findIndex((line) => {
        const lower = line.toLowerCase();
        return (
          lower === senderName.toLowerCase() ||
          lower.startsWith(senderName.toLowerCase()) ||
          (first !== undefined && first.length > 2 && lower === first)
        );
      })
    : -1;
  if (nameAt < 0) return signature;
  const titleLine = lines[nameAt + 1];
  if (!titleLine || !TITLE_WORDS.test(titleLine) || titleLine.length > 140)
    return signature;
  const [rolePart, ...rest] = titleLine.split(SPLIT_ROLE_ORG);
  const role = cleanPart(rolePart);
  if (role && TITLE_WORDS.test(role)) signature.role = role;
  const sameLineOrg = cleanPart(rest.join(" "));
  const nextLine = lines[nameAt + 2];
  const organization =
    sameLineOrg && !TITLE_WORDS.test(sameLineOrg)
      ? sameLineOrg
      : nextLine &&
          COMPANY_HINT.test(nextLine) &&
          !PHONE.test(nextLine) &&
          !/https?:|www\.|@/.test(nextLine)
        ? cleanPart(nextLine)
        : undefined;
  if (organization) signature.organization = organization;
  return signature;
}

const GREETING =
  /^(best|cheers|thanks|thank you|regards|kind regards|best regards|warm regards|all the best|sincerely|yours|beste grüße|viele grüße|liebe grüße|mit freundlichen grüßen|grüße|gruß|saludos|un saludo|atentamente|cordialmente)\b[\s,!.]*$/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PERSON_NAME = /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,3}$/u;

export interface PastedSignature extends Signature {
  name?: string;
  email?: string;
}

/**
 * The person behind a pasted signature. The name is the first line that reads
 * as two to four words, after any sign-off; the rest is `parseSignature` from
 * that name, plus the first email address.
 */
export function readSignature(text: string): PastedSignature {
  const lines = ownLines(text).filter((line) => !GREETING.test(line));
  const name = lines.find(
    (line) => PERSON_NAME.test(line) && !TITLE_WORDS.test(line),
  );
  const result: PastedSignature = parseSignature(
    lines.join("\n"),
    name ?? null,
  );
  if (name) result.name = name;
  const email = EMAIL.exec(lines.join("\n"))?.[0];
  if (email) result.email = email;
  return result;
}
