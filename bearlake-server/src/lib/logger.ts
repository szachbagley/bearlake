/**
 * The only sanctioned writer to stdout/stderr (plan D26).
 *
 * This server never logs request or response bodies — not on auth routes, not
 * anywhere. Temporary passwords, tokens, and the gate codes that live in
 * announcements and quick tips therefore have no path into the log at all,
 * which is a stronger guarantee than a per-route redaction list.
 *
 * Only pass scalar metadata to these functions. Never pass a request body, a
 * database row, a token, or an entity's text content.
 */

export type LogFields = Record<string, string | number | boolean | undefined>;

export interface LogRecord {
  level: 'info' | 'warn' | 'error';
  event: string;
  fields: LogFields;
}

export type LogSink = (record: LogRecord) => void;

function format(record: LogRecord): string {
  const parts = Object.entries(record.fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  return [`[${record.level}]`, record.event, ...parts].join(' ');
}

const consoleSink: LogSink = (record) => {
  const line = format(record);
  if (record.level === 'error') console.error(line);
  else console.log(line);
};

let sink: LogSink = consoleSink;

/** Test-only: redirect log output so the leakage tests can inspect it. */
export function setLogSink(next: LogSink): void {
  sink = next;
}

export function resetLogSink(): void {
  sink = consoleSink;
}

export const logger = {
  info(event: string, fields: LogFields = {}): void {
    sink({ level: 'info', event, fields });
  },
  warn(event: string, fields: LogFields = {}): void {
    sink({ level: 'warn', event, fields });
  },
  /**
   * Error detail stays server-side. `cause` is stringified here and never
   * echoed to a client — the client only ever sees the ApiError message.
   */
  error(event: string, cause?: unknown, fields: LogFields = {}): void {
    const detail =
      cause instanceof Error ? (cause.stack ?? `${cause.name}: ${cause.message}`) : undefined;
    sink({ level: 'error', event, fields: { ...fields, detail } });
  },
};
