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

export function SeatManagementContextProvider({
  children,
  showSeatManagement,
  unusedSeats: serverUnusedSeats,
}: {
  children: ReactNode;
  showSeatManagement: boolean;
  unusedSeats: number;
}) {
  const [pendingAssignCount, setPendingAssignCount] = useState(0);
  const [pendingUnassignCount, setPendingUnassignCount] = useState(0);
  const [optimisticallyAssignedMemberIds, setOptimisticallyAssignedMemberIds] =
    useState<Set<string>>(() => new Set());
  const [
    optimisticallyUnassignedMemberIds,
    setOptimisticallyUnassignedMemberIds,
  ] = useState<Set<string>>(() => new Set());
  const [syncedServerUnusedSeats, setSyncedServerUnusedSeats] =
    useState(serverUnusedSeats);

  if (serverUnusedSeats !== syncedServerUnusedSeats) {
    setSyncedServerUnusedSeats(serverUnusedSeats);
    setPendingAssignCount(0);
    setPendingUnassignCount(0);
    setOptimisticallyAssignedMemberIds(new Set());
    setOptimisticallyUnassignedMemberIds(new Set());
  }

  const unusedSeats = Math.max(
    0,
    serverUnusedSeats - pendingAssignCount + pendingUnassignCount,
  );

  function isMemberSeatAssigned(
    memberId: string,
    hasSeatFromServer: boolean,
  ): boolean {
    if (optimisticallyAssignedMemberIds.has(memberId)) {
      return true;
    }
    if (optimisticallyUnassignedMemberIds.has(memberId)) {
      return false;
    }
    return hasSeatFromServer;
  }

  function tryBeginSeatAssign(memberId: string): boolean {
    if (unusedSeats <= 0 || optimisticallyAssignedMemberIds.has(memberId)) {
      return false;
    }

    setPendingAssignCount((count) => count + 1);
    setOptimisticallyAssignedMemberIds((ids) => new Set(ids).add(memberId));
    return true;
  }

  function cancelSeatAssign(memberId: string): void {
    setPendingAssignCount((count) => Math.max(0, count - 1));
    setOptimisticallyAssignedMemberIds((ids) => {
      if (!ids.has(memberId)) {
        return ids;
      }

      const next = new Set(ids);
      next.delete(memberId);
      return next;
    });
  }

  function notifySeatUnassigned(memberId: string): void {
    setPendingUnassignCount((count) => count + 1);
    setOptimisticallyUnassignedMemberIds((ids) => new Set(ids).add(memberId));
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
