/**
 * Whether `expr` has the shape of a Task Schedule rule: five fields (minute,
 * hour, day of month, month, day of week), so no seconds field and no
 * `@daily`-style macro, and no `H` hashed value, which would land on a
 * different time each time it is read. It does not check the field values;
 * callers still parse the expression.
 */
export function isFiveFieldCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  // No month or weekday name starts with H, so a list item that does is hashed.
  return fields.length === 5 && !fields.some((field) => /(^|,)H/i.test(field));
}
