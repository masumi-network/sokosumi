import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/constants";

export const passwordSchema = ({
  minError,
  maxError,
  regexError,
}: {
  minError?: string;
  maxError?: string;
  regexError?: string;
}) =>
  z
    .string()
    .min(PASSWORD_MIN_LENGTH, minError)
    .max(PASSWORD_MAX_LENGTH, maxError)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, regexError);
