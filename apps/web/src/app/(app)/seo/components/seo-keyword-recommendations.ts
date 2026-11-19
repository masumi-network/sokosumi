export const MEDIUM_DIFFICULTY_FROM = 30;

interface KeywordSignals {
  conversion?: "high" | "medium" | "low" | null;
  difficulty: number | null;
}

export function recommendation(row: KeywordSignals) {
  if (!row.conversion) return null;
  const easy =
    row.difficulty !== null && row.difficulty < MEDIUM_DIFFICULTY_FROM;
  if (row.conversion === "high") return easy ? "both" : "goal";
  return easy ? "competition" : null;
}

/** Input order breaks ties and orders the remaining ideas. Never infer difficulty from missing data. */
export function recommendedOrder<T extends KeywordSignals>(
  rows: readonly T[],
): T[] {
  const groups: Record<"both" | "competition" | "goal" | "other", T[]> = {
    both: [],
    competition: [],
    goal: [],
    other: [],
  };
  for (const row of rows) groups[recommendation(row) ?? "other"].push(row);
  // Among strong goal matches, prefer the lower known difficulty, then input order.
  const difficulty = (row: T) => row.difficulty ?? Number.POSITIVE_INFINITY;
  const easiest = (a: T, b: T) => difficulty(a) - difficulty(b);
  groups.both.sort(easiest);
  groups.goal.sort(easiest);
  const mixed = [...groups.both];
  for (
    let i = 0;
    i < Math.max(groups.competition.length, groups.goal.length);
    i++
  ) {
    const lowerCompetition = groups.competition[i];
    const goalMatch = groups.goal[i];
    if (lowerCompetition) mixed.push(lowerCompetition);
    if (goalMatch) mixed.push(goalMatch);
  }
  return mixed.concat(groups.other);
}
