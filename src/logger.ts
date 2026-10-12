/** ISO 8601 in the server's local timezone, with the UTC offset so the instant stays unambiguous. */
function localTimestamp(): string {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, "0");
  const local = new Date(now.getTime() + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, -1);
  return `${local}${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}

/** Internal logger. Records codes and IDs only — never names or other PII. */
export const logger = {
  warn(event: string, meta: Record<string, string | number>): void {
    if (process.env["NODE_ENV"] === "test") return;
    console.warn(
      JSON.stringify({
        level: "warn",
        loggedAt: localTimestamp(),
        event,
        ...meta
      })
    );
  }
};
