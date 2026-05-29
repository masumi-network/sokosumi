"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

interface SeatManagementContextValue {
  showSeatManagement: boolean;
  unusedSeats: number;
  isMemberSeatAssigned: (
    memberId: string,
    hasSeatFromServer: boolean,
  ) => boolean;
  tryBeginSeatAssign: (memberId: string) => boolean;
  cancelSeatAssign: (memberId: string) => void;
  notifySeatUnassigned: (memberId: string) => void;
}

const SeatManagementContext = createContext<SeatManagementContextValue>({
  showSeatManagement: false,
  unusedSeats: 0,
  isMemberSeatAssigned: (_memberId, hasSeatFromServer) => hasSeatFromServer,
  tryBeginSeatAssign: () => false,
  cancelSeatAssign: () => {},
  notifySeatUnassigned: () => {},
});

interface SeatOptimisticState {
  pendingAssignCount: number;
  pendingUnassignCount: number;
  optimisticallyAssignedMemberIds: Set<string>;
  optimisticallyUnassignedMemberIds: Set<string>;
}

function createInitialOptimisticState(): SeatOptimisticState {
  return {
    pendingAssignCount: 0,
    pendingUnassignCount: 0,
    optimisticallyAssignedMemberIds: new Set(),
    optimisticallyUnassignedMemberIds: new Set(),
  };
}

function computeUnusedSeats(
  serverUnusedSeats: number,
  state: SeatOptimisticState,
): number {
  return Math.max(
    0,
    serverUnusedSeats - state.pendingAssignCount + state.pendingUnassignCount,
  );
}

export function SeatManagementContextProvider({
  children,
  showSeatManagement,
  unusedSeats: serverUnusedSeats,
}: {
  children: ReactNode;
  showSeatManagement: boolean;
  unusedSeats: number;
}) {
  const [optimisticState, setOptimisticState] = useState<SeatOptimisticState>(
    createInitialOptimisticState,
  );
  const [syncedServerUnusedSeats, setSyncedServerUnusedSeats] =
    useState(serverUnusedSeats);

  if (serverUnusedSeats !== syncedServerUnusedSeats) {
    setSyncedServerUnusedSeats(serverUnusedSeats);
    setOptimisticState(createInitialOptimisticState());
  }

  const unusedSeats = computeUnusedSeats(serverUnusedSeats, optimisticState);

  function isMemberSeatAssigned(
    memberId: string,
    hasSeatFromServer: boolean,
  ): boolean {
    if (optimisticState.optimisticallyAssignedMemberIds.has(memberId)) {
      return true;
    }
    if (optimisticState.optimisticallyUnassignedMemberIds.has(memberId)) {
      return false;
    }
    return hasSeatFromServer;
  }

  function tryBeginSeatAssign(memberId: string): boolean {
    let accepted = false;

    setOptimisticState((prev) => {
      const availableUnused = computeUnusedSeats(serverUnusedSeats, prev);
      if (
        availableUnused <= 0 ||
        prev.optimisticallyAssignedMemberIds.has(memberId)
      ) {
        return prev;
      }

      accepted = true;
      return {
        ...prev,
        pendingAssignCount: prev.pendingAssignCount + 1,
        optimisticallyAssignedMemberIds: new Set(
          prev.optimisticallyAssignedMemberIds,
        ).add(memberId),
      };
    });

    return accepted;
  }

  function cancelSeatAssign(memberId: string): void {
    setOptimisticState((prev) => {
      if (!prev.optimisticallyAssignedMemberIds.has(memberId)) {
        return prev;
      }

      const nextAssigned = new Set(prev.optimisticallyAssignedMemberIds);
      nextAssigned.delete(memberId);
      return {
        ...prev,
        pendingAssignCount: Math.max(0, prev.pendingAssignCount - 1),
        optimisticallyAssignedMemberIds: nextAssigned,
      };
    });
  }

  function notifySeatUnassigned(memberId: string): void {
    setOptimisticState((prev) => ({
      ...prev,
      pendingUnassignCount: prev.pendingUnassignCount + 1,
      optimisticallyUnassignedMemberIds: new Set(
        prev.optimisticallyUnassignedMemberIds,
      ).add(memberId),
    }));
  }

  return (
    <SeatManagementContext
      value={{
        showSeatManagement,
        unusedSeats,
        isMemberSeatAssigned,
        tryBeginSeatAssign,
        cancelSeatAssign,
        notifySeatUnassigned,
      }}
    >
      {children}
    </SeatManagementContext>
  );
}

export function useSeatManagementContext(): SeatManagementContextValue {
  return useContext(SeatManagementContext);
}
