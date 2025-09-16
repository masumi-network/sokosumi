export type JSONValue =
  | string
  | number
  | boolean
  | JSONValue[]
  | { [key: string]: JSONValue };
