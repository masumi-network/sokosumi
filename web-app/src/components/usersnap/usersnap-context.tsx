"use client";
import type { SpaceApi } from "@usersnap/browser";
import React from "react";

export const UsersnapContext = React.createContext<SpaceApi | null>(null);
