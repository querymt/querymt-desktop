import { describe, expect, it } from 'vitest';
import { parseShellToolOutput } from './session-tool-shell-output';

describe('parseShellToolOutput', () => {
  it('parses stdout, stderr and exit code from the JSON payload', () => {
    const output = parseShellToolOutput(
      JSON.stringify({ command: 'ls', stdout: 'src\n', stderr: 'warn\n', exit_code: 0 })
    );
    expect(output).toEqual({ stdout: 'src\n', stderr: 'warn\n', exitCode: 0 });
  });

  it('reads camelCase exitCode fields too', () => {
    const output = parseShellToolOutput(JSON.stringify({ stdout: '', stderr: 'boom', exitCode: 3 }));
    expect(output).toEqual({ stdout: '', stderr: 'boom', exitCode: 3 });
  });

  it('treats empty streams as valid output with a null exit code', () => {
    const output = parseShellToolOutput('{"stdout":"","stderr":""}');
    expect(output).toEqual({ stdout: '', stderr: '', exitCode: null });
  });

  it('returns null when neither stream field exists', () => {
    expect(parseShellToolOutput('{"command":"ls","exit_code":1}')).toBeNull();
    expect(parseShellToolOutput('{"stdout":42,"stderr":null}')).toBeNull();
  });

  it('returns null for non-JSON payloads', () => {
    expect(parseShellToolOutput('plain text output')).toBeNull();
    expect(parseShellToolOutput('{"stdout": truncated')).toBeNull();
    expect(parseShellToolOutput(null)).toBeNull();
    expect(parseShellToolOutput('')).toBeNull();
  });
});
