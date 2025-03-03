import { z, ZodSchema } from "zod";

type FormData<T extends z.infer<ZodSchema>> = Array<{
  name: keyof T;
  type?: React.HTMLInputTypeAttribute;
  label?: string;
  placeholder?: string;
  description?: string;
}>;

export type { FormData };
