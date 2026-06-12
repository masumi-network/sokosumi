import * as z from "zod";

export const betterAuthApiErrorSchema = z.object({
  status: z.string(),
  statusCode: z.number(),
  body: z.object({
    code: z.string(),
    message: z.string().nullish(),
  }),
});

export type BetterAuthApiErrorSchemaType = z.infer<
  typeof betterAuthApiErrorSchema
>;

export type BetterAuthClientError = {
  code?: string | undefined;
  message?: string | undefined;
  status: number;
  statusText: string;
};

export type BetterAuthClientResult<T> = {
  data: T;
  error: BetterAuthClientError | null;
};
