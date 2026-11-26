"use client";

import { createContext } from "react";

/**
 * The activity event whose comment holds a table, so the same table in two events stays two copies. Null for
 * a comment not saved yet: its row is replaced once it is, so it offers no Save as table.
 */
export const TaskTableEvent = createContext<string | null>(null);
