import { z } from "zod";

export const passwordSchema = ({
  minError,
  regexError,
}: {
  minError?: string;
  regexError?: string;
}) =>
  z
    .string()
    .min(8, minError)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, regexError);
