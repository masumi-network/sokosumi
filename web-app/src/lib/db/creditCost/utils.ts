// NOTE:
// We treat `""` as standard Unit of Ada (lovelace) in our DB (internal representation)
// but some agents use `"lovelace"` (external representation)
// so we need to normalize and denormalize units when we query the DB
export function normalizeUnit(unit: string) {
  return unit === "lovelace" ? "" : unit;
}

export function denormalizeUnit(unit: string) {
  return unit === "" ? "lovelace" : unit;
}
