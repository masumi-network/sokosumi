// Receipts stay with the CMO search that made the purchase.
export const EDITORIAL_BATCH_SIZE = 3;
export interface NativeKeywordReceipt {
  costUsd: number | null;
  taskId: string | null;
  exactKeywords: string[];
}

const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const cost = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
export const keywordKey = (text: string) =>
  text.normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ");

export function nativeKeywordReceipt(
  payload: Record<string, unknown>,
  query: { topic: string; locationCode: number; languageCode: string },
  keywords?: readonly string[],
): NativeKeywordReceipt {
  const tasks = list(payload.tasks);
  const task = obj(tasks[0]);
  const receipt: NativeKeywordReceipt = {
    costUsd:
      cost(payload.cost) ?? (tasks.length === 1 ? cost(task.cost) : null),
    taskId: typeof task.id === "string" ? task.id : null,
    exactKeywords: [],
  };
  if (
    payload.status_code !== 20000 ||
    tasks.length !== 1 ||
    task.status_code !== 20000
  )
    return receipt;
  const data = obj(task.data);
  const requested = keywords ? new Set(keywords.map(keywordKey)) : null;
  if (requested && data.keywords !== undefined) {
    const echoed = list(data.keywords);
    if (
      echoed.length !== requested.size ||
      !echoed.every(
        (k) => typeof k === "string" && requested.has(keywordKey(k)),
      ) ||
      new Set(echoed.map((k) => keywordKey(String(k)))).size !== requested.size
    )
      return receipt;
  }
  const occurrences = new Map<string, number>();
  for (const raw of list(task.result)) {
    for (const value of list(obj(raw).items)) {
      const k = obj(value).keyword;
      if (typeof k === "string")
        occurrences.set(
          keywordKey(k),
          (occurrences.get(keywordKey(k)) ?? 0) + 1,
        );
    }
    const result = obj(raw);
    const topics = [data.keyword, result.keyword].filter(
      (v) => v !== undefined,
    );
    if (
      !requested &&
      topics.some(
        (v) =>
          typeof v !== "string" || keywordKey(v) !== keywordKey(query.topic),
      )
    )
      continue;
    for (const value of list(result.items)) {
      const item = obj(value);
      const layers = [data, result, item, obj(item.keyword_data)];
      if (
        !Object.entries({
          location_code: query.locationCode,
          language_code: query.languageCode,
        }).every(([key, wanted]) => {
          const echoed = layers.filter((layer) => layer[key] !== undefined);
          return (
            echoed.length > 0 && echoed.every((layer) => layer[key] === wanted)
          );
        })
      )
        continue;
      if (
        typeof item.keyword === "string" &&
        (!requested || requested.has(keywordKey(item.keyword)))
      )
        receipt.exactKeywords.push(keywordKey(item.keyword));
    }
  }
  receipt.exactKeywords = receipt.exactKeywords.filter(
    (k) => occurrences.get(k) === 1,
  );
  return receipt;
}
