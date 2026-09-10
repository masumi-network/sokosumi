import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export * from "./datetime";
export * from "./duration";
export * from "./email";
export * from "./gradient";
export * from "./parse-date";
export * from "./user-agent";
