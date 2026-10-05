/**
 * Whether `expr` has the shape a Task Schedule rule's cron must have: five
 * fields (minute, hour, day of month, month, day of week), so no seconds field
 * and no `@daily`-style macro, and no `H` hashed value anywhere, which would
 * land on a different time each time it is read. It does not check the field
 * values; callers still parse the expression.
 */
export function isTaskScheduleCronShape(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  // THU is the only month or weekday name with an H in it.
  return fields.length === 5 && !/H/i.test(expr.replace(/THU/gi, ""));
}
