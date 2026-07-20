"use client";

import { createContext } from "react";

import { orbSeedFor } from "@/lib/aurora-orb";

/**
 * Fixed orb seed for the landing-page demo visuals. The hero shows the
 * porcelain placeholder ("not yours yet"); the mocks show an example
 * activated assistant in jewel sky — friendly, confident, and distinct from
 * the page's purple accent. The user picks their own colour in setup.
 */
export const DEMO_ORB_SEED = orbSeedFor("jewel-sky", "hermes-demo");

/** The demo orb seed, shared with the journey-visual sub-components
 * (referenced via a data array, so prop-threading would be awkward). */
export const EmptyStateSeedContext = createContext<string>(DEMO_ORB_SEED);
