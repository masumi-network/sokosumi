import type { Result } from "neverthrow";

/**
 * Plain serializable Result for Next.js server-action returns.
 *
 * neverthrow class methods do not survive Flight serialization. Build with
 * neverthrow in-process, then map at the action boundary with
 * {@link toActionResult}. Clients check `result.ok` and read `result.value`
 * (not `result.data` — that was the retired `@/lib/ts-res` shape).
 *
 * `T` and `E` must themselves be plain JSON/Flight-safe values (no class
 * instances, `Map`, functions, or other non-serializable payloads).
 */
export type ActionResultDto<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Project a neverthrow {@link Result} onto the server-action wire DTO.
 *
 * Only maps the envelope; `T` and `E` must already be Flight-serializable.
 */
export function toActionResult<T, E>(
  result: Result<T, E>,
): ActionResultDto<T, E> {
  if (result.isOk()) {
    return { ok: true, value: result.value };
  }
  return { ok: false, error: result.error };
}
