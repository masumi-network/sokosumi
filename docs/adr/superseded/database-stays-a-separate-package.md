# `@sokosumi/database` stays a separate package

- Status: Superseded by [ADR-0035](../0035-database-consumed-from-source.md)
- Archived: live number 0034 is retired; do not reuse it

This ADR kept `@sokosumi/database` as a separate package and rejected both the just-in-time switch and folding it into `apps/core`, on the grounds that each produced 31 type errors in Core and that the package's `tsc` build was therefore load-bearing.

**That reasoning was wrong in its central claim.** The 31 errors are not evidence that the emitted declarations are better than the source. They are evidence of the opposite: declaration emit widens 18 of Prisma's runtime value re-exports to `any`, so the built `.d.ts` was masking real type errors that source resolution surfaces. See [ADR-0035](../0035-database-consumed-from-source.md) for the root cause, the measurements, and the decision that replaces this one.

What this ADR got right and [ADR-0035](../0035-database-consumed-from-source.md) keeps: the single-consumer observation (`apps/core` is the only workspace declaring the package, `packages/utils` names it in comments only, `apps/web` has none), and the rejection of "keep the package because it enforces the web/Prisma boundary" — that boundary is not load-bearing, because `apps/web` has no dependency on `apps/core` either.
