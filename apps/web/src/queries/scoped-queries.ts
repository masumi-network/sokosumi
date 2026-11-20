"use client";

import {
  type DefaultError,
  hashKey,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useQueryErrorReport } from "@/hooks/effects/use-query-error-report";
import { useSession } from "@/lib/auth/auth.client";

export const PERSONAL_WORKSPACE_SCOPE = "personal" as const;

export interface QueryScope {
  /** Active organization id/slug, or `"personal"` for the personal workspace. */
  workspace: string;
  /** Signed-in viewer user id, or `null` while pending / signed out. */
  userId: string | null;
}

export type ScopedQueryKey<TQueryKey extends QueryKey = QueryKey> = readonly [
  string,
  string | null,
  ...TQueryKey,
];

export function buildScopedQueryKey<TQueryKey extends QueryKey>(
  scope: QueryScope,
  queryKey: TQueryKey,
): ScopedQueryKey<TQueryKey> {
  return [scope.workspace, scope.userId, ...queryKey] as const;
}

/**
 * Current workspace + viewer scope for migrated React Query keys.
 *
 * Pass `workspaceOverride` when a route owns an explicit workspace key (such as
 * an organization slug on `/organizations/[organizationSlug]` or `null` for
 * personal); otherwise the active session organization (or `"personal"`) is used.
 */
export function useQueryScope(workspaceOverride?: string | null): QueryScope {
  const { data: session } = useSession();
  const workspace =
    workspaceOverride !== undefined
      ? workspaceOverride || PERSONAL_WORKSPACE_SCOPE
      : session?.session?.activeOrganizationId || PERSONAL_WORKSPACE_SCOPE;
  const userId = session?.user?.id || null;

  return { workspace, userId };
}

export interface UseScopedQueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> extends Omit<
    UseQueryOptions<TQueryFnData, TError, TData, ScopedQueryKey<TQueryKey>>,
    "queryKey"
  > {
  queryKey: TQueryKey;
  workspace?: string | null;
  /** Called once per failure while this observer is mounted on the failing key. */
  onError?: (error: TError) => void;
}

export function useScopedQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: UseScopedQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
  const {
    queryKey,
    workspace,
    onError,
    enabled,
    networkMode = "always",
    retry = false,
    refetchOnWindowFocus = false,
    ...rest
  } = options;
  const scope = useQueryScope(workspace);
  const scopedQueryKey = buildScopedQueryKey(scope, queryKey);
  const resolvedEnabled = !scope.userId
    ? false
    : typeof enabled === "function"
      ? enabled
      : (enabled ?? true);

  const result = useQuery({
    ...rest,
    queryKey: scopedQueryKey,
    enabled: resolvedEnabled,
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
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
> extends Omit<
    UseInfiniteQueryOptions<
      TQueryFnData,
      TError,
      TData,
      ScopedQueryKey<TQueryKey>,
      TPageParam
    >,
    "queryKey"
  > {
  queryKey: TQueryKey;
  workspace?: string | null;
  /** Called once per failure while this observer is mounted on the failing key. */
  onError?: (error: TError) => void;
}

export function useScopedInfiniteQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  options: UseScopedInfiniteQueryOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryKey,
    TPageParam
  >,
): UseInfiniteQueryResult<TData, TError> {
  const {
    queryKey,
    workspace,
    onError,
    enabled,
    networkMode = "always",
    retry = false,
    refetchOnWindowFocus = false,
    ...rest
  } = options;
  const scope = useQueryScope(workspace);
  const scopedQueryKey = buildScopedQueryKey(scope, queryKey);
  const resolvedEnabled = !scope.userId
    ? false
    : typeof enabled === "function"
      ? enabled
      : (enabled ?? true);

  const result = useInfiniteQuery({
    ...rest,
    queryKey: scopedQueryKey,
    enabled: resolvedEnabled,
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

interface ScopedMutationContext {
  scopedPrefix: ScopedQueryKey;
}

export interface UseScopedMutationOptions<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TCacheData = unknown,
> extends Omit<
    UseMutationOptions<TData, TError, TVariables, ScopedMutationContext>,
    "mutationFn" | "onMutate" | "onSuccess" | "onError" | "onSettled"
  > {
  /** Unscoped key prefix of queries affected by this write; workspace + viewer are prepended automatically. */
  queryKeyPrefix: QueryKey;
  workspace?: string | null;
  mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * Optional cache update applied after the write succeeds and before
   * invalidating `queryKeyPrefix`. Runs only for matching queries already in
   * `status === "success"` so a write never marks a failed or unloaded list as
   * loaded.
   */
  applySuccess?: (
    previous: TCacheData,
    data: TData,
    variables: TVariables,
    queryKey: QueryKey,
  ) => TCacheData | undefined;
  onSuccess?: (
    data: TData,
    variables: TVariables,
  ) => Promise<unknown> | unknown;
  onError?: (
    error: TError,
    variables: TVariables,
  ) => Promise<unknown> | unknown;
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
  ) => Promise<unknown> | unknown;
}

export function useScopedMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TCacheData = unknown,
>(
  options: UseScopedMutationOptions<TData, TError, TVariables, TCacheData>,
): UseMutationResult<TData, TError, TVariables, ScopedMutationContext> {
  const {
    queryKeyPrefix,
    workspace,
    mutationFn,
    applySuccess,
    onSuccess,
    onError,
    onSettled,
    networkMode = "always",
    ...rest
  } = options;
  const queryClient = useQueryClient();
  const scope = useQueryScope(workspace);

  return useMutation<TData, TError, TVariables, ScopedMutationContext>({
    ...rest,
    networkMode,
    onMutate: async () => {
      const scopedPrefix = buildScopedQueryKey(scope, queryKeyPrefix);
      await queryClient.cancelQueries({ queryKey: scopedPrefix });
      return { scopedPrefix };
    },
    mutationFn: (variables) => mutationFn(variables),
    onSuccess: async (data, variables, onMutateResult) => {
      const targetPrefix =
        onMutateResult?.scopedPrefix ??
        buildScopedQueryKey(scope, queryKeyPrefix);

      if (applySuccess) {
        // Cancel any read that started while the write was in flight, then
        // patch only already-loaded queries so a failed/unloaded list stays
        // failed/unloaded until a real read succeeds.
        await queryClient.cancelQueries({ queryKey: targetPrefix });
        for (const query of queryClient
          .getQueryCache()
          .findAll({ queryKey: targetPrefix })) {
          if (
            query.state.status !== "success" ||
            query.state.data === undefined
          ) {
            continue;
          }
          const next = applySuccess(
            query.state.data as TCacheData,
            data,
            variables,
            query.queryKey,
          );
          if (next !== undefined) {
            queryClient.setQueryData(query.queryKey, next);
          }
        }
      }

      await queryClient.invalidateQueries({ queryKey: targetPrefix });
      await onSuccess?.(data, variables);
    },
    onError: (error, variables) => onError?.(error, variables),
    onSettled: (data, error, variables) => onSettled?.(data, error, variables),
  });
}
