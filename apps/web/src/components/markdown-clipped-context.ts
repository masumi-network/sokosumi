"use client";

import { createContext } from "react";

/**
 * True while expandable Markdown is cut at its clamp. Content below the clamp stays mounted but hidden, so a
 * replacement component that adds a control leaves it out until the reader expands.
 */
export const MarkdownClippedContext = createContext(false);
