/**
 * The fork's log. activateOurs connects the output channel "T3 VSCode (fork)" (his host has none); before that, and in
 * tests, messages go to the console. Type-only vscode import, so wrap.ts and tests can use it.
 */
import type * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;
export function setLogChannel(next: vscode.LogOutputChannel | undefined): void { channel = next; }

const detail = (cause: unknown) => cause instanceof Error ? cause.stack ?? cause.message : String(cause);
export const log = {
  info: (message: string): void => { if (channel) channel.info(message); else console.log(message); },
  error: (message: string, cause?: unknown): void => {
    const text = cause === undefined ? message : `${message} ${detail(cause)}`;
    if (channel) channel.error(text); else console.error(text);
  },
};
