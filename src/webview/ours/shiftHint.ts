/**
 * Q21 shiftHint: a VS Code drag without Shift bounces off the webview (drop.ts detects it). The toast is easy to miss,
 * so a short note also shows over his composer box for 2 s. It never takes pointer events, so the next drop still lands.
 */
const SHOW_MS = 2000;

const style = document.createElement("style");
style.textContent = `
.ours-shift-hint { position: fixed; z-index: 1000; transform: translate(-50%, -50%); pointer-events: none; white-space: nowrap;
  padding: 4px 10px; border-radius: 4px; font-size: .75rem; border: 1px solid var(--vscode-widget-border, var(--border));
  background: var(--vscode-editorHoverWidget-background, var(--card)); color: var(--vscode-editorHoverWidget-foreground, var(--foreground));
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.3)); }`;
document.head.append(style);

// Always in the DOM, so the live region announces the text when it is set.
const note = document.createElement("div");
note.className = "ours-shift-hint";
note.setAttribute("role", "status");
note.setAttribute("aria-live", "polite");
note.hidden = true;
document.body.append(note);
let timer: ReturnType<typeof setTimeout> | undefined;

export function showShiftHint(): void {
  try {
    const box = document.querySelector(".composer-box")?.getBoundingClientRect();
    note.style.left = `${box ? box.left + box.width / 2 : window.innerWidth / 2}px`;
    note.style.top = `${box ? box.top + box.height / 2 : window.innerHeight - 60}px`;
    note.textContent = "Hold Shift to drop files here";
    note.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { note.hidden = true; note.textContent = ""; }, SHOW_MS);
  } catch (cause) { console.error("T3 VSCode (fork): shift hint failed", cause); }
}
