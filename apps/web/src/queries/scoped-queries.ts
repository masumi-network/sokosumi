"use client";

import {
  type DefaultError,
  hashKey,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  type UseQueryOptions,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useQueryErrorReport } from "@/hooks/effects/use-query-error-report";

export type ScopedQueryKey<
  TScope = unknown,
  TQueryKey extends QueryKey = QueryKey,
> = readonly [TScope, ...TQueryKey];

export function buildScopedQueryKey<TScope, TQueryKey extends QueryKey>(
  scope: TScope,
  queryKey: TQueryKey,
): ScopedQueryKey<TScope, TQueryKey> {
  return [scope, ...queryKey] as const;
}

export interface UseScopedQueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TScope = unknown,
  TQueryKey extends QueryKey = QueryKey,
> extends Omit<
    UseQueryOptions<
      TQueryFnData,
      TError,
      TData,
      ScopedQueryKey<TScope, TQueryKey>
    >,
    "queryKey"
  > {
  /**
   * Explicit cache scope matching the exact identifier the request uses
   * (for example organization slug or workspace id, plus viewer id where the
   * server filters per member).
   */
  scope: TScope;
  queryKey: TQueryKey;
  /** Called once per failure while this observer is mounted on the failing key. */
  onError?: (error: TError) => void;
}

export function useScopedQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TScope = unknown,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: UseScopedQueryOptions<
    TQueryFnData,
    TError,
    TData,
    TScope,
    TQueryKey
  >,
): UseQueryResult<TData, TError> {
  const {
    scope,
    queryKey,
    onError,
    networkMode = "always",
    retry = false,
    refetchOnWindowFocus = false,
    ...rest
  } = options;
  const scopedQueryKey = buildScopedQueryKey(scope, queryKey);

  const result = useQuery({
    ...rest,
    queryKey: scopedQueryKey,
    networkMode,
    retry,
    refetchOnWindowFocus,
  });

  useQueryErrorReport(
    hashKey(scopedQueryKey),
    result.error,
    result.errorUpdateCount,
    onError,
  );

  return result;
}

export interface UseScopedInfiniteQueryOptions<
  TQueryFnData,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TScope = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
> extends Omit<
    UseInfiniteQueryOptions<
      TQueryFnData,
      TError,
      TData,
      ScopedQueryKey<TScope, TQueryKey>,
      TPageParam
    >,
    "queryKey"
  > {
  /**
   * Explicit cache scope matching the exact identifier the request uses
   * (for example organization slug or workspace id, plus viewer id where the
   * server filters per member).
   */
  scope: TScope;
  queryKey: TQueryKey;
  /** Called once per failure while this observer is mounted on the failing key. */
  onError?: (error: TError) => void;
}

export function useScopedInfiniteQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TScope = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  options: UseScopedInfiniteQueryOptions<
    TQueryFnData,
    TError,
    TData,
    TScope,
    TQueryKey,
    TPageParam
  >,
): UseInfiniteQueryResult<TData, TError> {
  const {
    scope,
    queryKey,
    onError,
    networkMode = "always",
    retry = false,
    refetchOnWindowFocus = false,
    ...rest
  } = options;
  const scopedQueryKey = buildScopedQueryKey(scope, queryKey);

  const result = useInfiniteQuery({
    ...rest,
    queryKey: scopedQueryKey,
    networkMode,
    retry,
    refetchOnWindowFocus,
  });

  useQueryErrorReport(
    hashKey(scopedQueryKey),
    result.error,
    result.errorUpdateCount,
    onError,
  );

  return result;
}
