// Shell tools (shell/execute) answer with a JSON payload that carries the
// command output as separate stream fields, e.g.:
//
//   {"command":"ls","stdout":"src\n","stderr":"","exit_code":0}
//
// Older persisted sessions may hold plain text instead; when this parser
// returns null the caller falls back to rendering the raw result text as a
// single output stream.

export type ShellToolOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export function parseShellToolOutput(rawResult: string | null | undefined): ShellToolOutput | null {
  const text = rawResult?.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const stdout = readStreamField(record, ['stdout', 'out']);
  const stderr = readStreamField(record, ['stderr', 'err']);
  if (stdout === null && stderr === null) return null;

  return {
    stdout: stdout ?? '',
    stderr: stderr ?? '',
    exitCode: readExitCode(record)
  };
}

function readStreamField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function readExitCode(record: Record<string, unknown>): number | null {
  for (const key of ['exit_code', 'exitCode', 'code', 'status']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}
