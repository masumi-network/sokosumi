export function resolvePurchasedSeats(
  seats: number | null | undefined,
): number {
  return seats && seats > 0 ? seats : 1;
}

export function getUnusedSeatCount(
  purchasedSeats: number,
  assignedCount: number,
): number {
  return Math.max(purchasedSeats - assignedCount, 0);
}

export function ensureAssignedSeatsWithinCapacity(
  assignedCount: number,
  purchasedSeats: number,
): void {
  if (assignedCount > purchasedSeats) {
    throw new Error(
      `Assigned seat count (${assignedCount}) exceeds purchased seats (${purchasedSeats})`,
    );
  }
}

export function ensurePurchasedSeatsSufficient(
  purchasedSeats: number,
  assignedCount: number,
): void {
  if (!Number.isInteger(purchasedSeats) || purchasedSeats < 1) {
    throw new Error("Purchased seats must be an integer of at least 1");
  }

  if (purchasedSeats < assignedCount) {
    throw new Error(
      `Purchased seats (${purchasedSeats}) must be at least ${assignedCount} to cover all assigned members`,
    );
  }
}

export function getSortedUniqueUserIds(userIds: string[]): string[] {
  return [...new Set(userIds)].toSorted();
}
