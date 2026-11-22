/**
 * Marketing words a CMO owner, a founder who is not a marketer, would have
 * to look up, each with what to say instead. Cuso's rules quote this list
 * and Core's strategy review refuses these words in what the owner reads
 * (owner, 2026-11-22: "crystal clear and understandable for non-marketing
 * people. EASY.").
 */
export const CMO_PLAIN_WORDS: readonly {
  /** How the word is written; matched as a whole word, any case. */
  term: string;
  /** What to say instead, as an instruction. */
  plain: string;
  /** The word as a pattern when it needs more than the plain term. */
  pattern?: RegExp;
}[] = [
  { term: "impressions", plain: "how many people saw it" },
  {
    term: "engagement",
    plain: "likes, replies and shares",
    pattern: /\bengagements?( rate)?\b/i,
  },
  {
    term: "CTR",
    plain: "how many who saw it clicked",
    pattern: /\b(CTR|click-?through( rate)?)\b/i,
  },
  {
    term: "conversion",
    plain: "the sign-up, sale or booking itself",
    pattern: /\bconver(sions?|t(s|ed|ing)?)\b/i,
  },
  {
    term: "leads",
    plain: "the people by name (founders who…) or the sign-ups",
    // Only the marketing noun: "qualified leads", "for leads", a sentence
    // that starts "Leads …". A job title ("project leads") stays.
    pattern:
      /(^|[.!?:;]\s+|\b(qualified|new|more|warm|cold|inbound|sales|marketing|the|our|your|these|those|of|from|get|generate|capture|nurture|convert|for|turn|bring|with)\s+)leads\b/i,
  },
  { term: "qualified", plain: "who they are (leave the word out)" },
  {
    term: "funnel",
    plain: "the steps from first hearing of you to buying",
  },
  { term: "cadence", plain: "how often" },
  { term: "ICP", plain: "your best buyer" },
  { term: "SERP", plain: "Google's results" },
  { term: "KPI", plain: "the number we watch", pattern: /\bKPIs?\b/ },
  {
    term: "touchpoint",
    plain: "where they see you",
    pattern: /\btouchpoints?\b/i,
  },
  {
    term: "top of funnel",
    plain: "people who don't know you yet",
    pattern:
      /\b(top|middle|bottom)[- ]of[- ](the[- ])?funnel\b|\b(TOFU|MOFU|BOFU)\b/i,
  },
  {
    term: "nurture",
    plain: "keep in touch with",
    pattern: /\bnurtur(e|es|ed|ing)\b/i,
  },
  { term: "activation", plain: "the first time they really use it" },
  { term: "attribution", plain: "where each sign-up came from" },
  {
    term: "retargeting",
    plain: "ads to people who visited before",
    pattern: /\bre-?target(ing|ed)?\b/i,
  },
  { term: "UGC", plain: "posts made by customers" },
  { term: "CTA", plain: "the one thing to do next", pattern: /\bCTAs?\b/ },
  { term: "thought leadership", plain: "what you know that others don't" },
  { term: "value proposition", plain: "why people buy it" },
  { term: "awareness", plain: "people finding out about you" },
  { term: "omnichannel", plain: "every network" },
];

/** The words from `CMO_PLAIN_WORDS` in `text`, each once, in list order. */
export function cmoJargonIn(text: string): { term: string; plain: string }[] {
  return CMO_PLAIN_WORDS.filter(({ term, pattern }) =>
    (
      pattern ??
      new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    ).test(text),
  ).map(({ term, plain }) => ({ term, plain }));
}

/** The list as one line for Cuso's rules: `"impressions" → how many people saw it; …`. */
export function cmoPlainWordsLine(): string {
  return CMO_PLAIN_WORDS.map(({ term, plain }) => `"${term}" → ${plain}`).join(
    "; ",
  );
}
