export type ErrorType =
  | string
  | { name?: string; code?: string; message: string }
  | undefined
  | void;

export type Success<T> = {
  ok: true;
  data: T;
};

export type Failure<E extends ErrorType> = {
  ok: false;
  error: E;
};

export type Result<T, E extends ErrorType> = Success<T> | Failure<E>;

export function Ok<T>(): Result<T | undefined, never>;
export function Ok<T>(data: T): Result<T, never>;
export function Ok<T>(data?: T): Result<T | undefined, never> {
  return { ok: true, data };
}

export function Err<E extends ErrorType>(): Result<never, E | undefined>;
export function Err<E extends ErrorType>(error: E): Result<never, E>;
export function Err<E extends ErrorType>(
  error?: E,
): Result<never, E | undefined> {
  return { ok: false, error };
}
