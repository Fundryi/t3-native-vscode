/** The last terminal commands with their output, from shell integration (legacy context.js). Read by A and D. */
import * as vscode from "vscode";

const MAX_RUNS = 20;
const MAX_OUTPUT = 8192;
const MAX_COMMAND = 1024;

export interface TerminalRun {
  readonly terminal: string;
  readonly cwd: string | null;
  readonly commandLine: string;
  exitCode: number | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Raw VT data, the last MAX_OUTPUT characters. */
  output: string;
  truncated: boolean;
}

const runs: TerminalRun[] = [];
/** Oldest first, at most 20. */
export const terminalRuns = (): ReadonlyArray<TerminalRun> => runs;

export function activateTerminalRuns(): vscode.Disposable {
  const open = new WeakMap<vscode.TerminalShellExecution, TerminalRun>();
  const record = (terminal: vscode.Terminal, execution: vscode.TerminalShellExecution): TerminalRun => ({
    terminal: terminal.name, cwd: execution.cwd?.fsPath ?? null, commandLine: execution.commandLine.value.slice(0, MAX_COMMAND),
    exitCode: null, startedAt: Date.now(), endedAt: null, output: "", truncated: false,
  });
  return vscode.Disposable.from(
    vscode.window.onDidStartTerminalShellExecution(({ terminal, execution }) => {
      const run = record(terminal, execution);
      open.set(execution, run);
      // Data written before the first read() is lost, so read at once.
      const stream = execution.read();
      void (async () => {
        try {
          for await (const chunk of stream) {
            const output = run.output + chunk;
            if (output.length > MAX_OUTPUT) run.truncated = true;
            run.output = output.slice(-MAX_OUTPUT);
          }
        } catch { /* the terminal closed mid-stream: keep what arrived */ }
      })();
    }),
    // An end without a start: the command began before this window listened; it gets a record without output.
    vscode.window.onDidEndTerminalShellExecution(({ terminal, execution, exitCode }) => {
      const run = open.get(execution) ?? { ...record(terminal, execution), startedAt: null };
      open.delete(execution);
      run.exitCode = exitCode ?? null; run.endedAt = Date.now();
      runs.push(run);
      if (runs.length > MAX_RUNS) runs.shift();
    }),
  );
}
