// Live check: runs scripts/livecheck/index.js inside a real, isolated VS Code window (extension development host).
// Unpaired: no T3 bearer, no POST to T3, no t3 CLI. Own user data, extensions dir and T3VSCODE_HOME under a temp folder.
// Usage: node scripts/livecheck.mjs   (Windows, VS Code user install)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
const tmp = path.join(os.tmpdir(), `t3-livecheck-${process.pid}`);
const ws = path.join(tmp, 'ws');
const resultFile = path.join(tmp, 'result.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(code)) { console.error(`FAIL VS Code not found at ${code}`); process.exit(1); }
for (const d of ['udd', 'ext', 'home', 'ws']) fs.mkdirSync(path.join(tmp, d), { recursive: true });

// A small repository so gitState has a branch, a modified file and an untracked file. Invented content only.
const git = (...a) => execFileSync('git', ['-c', 'user.name=livecheck', '-c', 'user.email=livecheck@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: ws, encoding: 'utf8', stdio: 'pipe' });
git('init', '-q', '-b', 'main');
fs.writeFileSync(path.join(ws, 'a.ts'), '// TODO: say hello\nexport const a = 1;\nexport const b = 2;\n');
fs.writeFileSync(path.join(ws, 'b.ts'), 'export const c = 3;\n');
git('add', 'a.ts', 'b.ts');
git('commit', '-q', '-m', 'fixture');
fs.appendFileSync(path.join(ws, 'b.ts'), 'export const d = 4;\n');
fs.writeFileSync(path.join(ws, 'c.txt'), 'untracked\n');
const porcelain = git('status', '--porcelain');
if (!porcelain.includes(' M b.ts') || !porcelain.includes('?? c.txt')) { console.error(`FAIL fixture repository not as expected:\n${porcelain}`); process.exit(1); }

// The parent may itself run inside VS Code: its ELECTRON_* and VSCODE_* variables would turn Code.exe into plain Node.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|VSCODE_)/.test(k)));
env.T3VSCODE_HOME = path.join(tmp, 'home');
const args = ['--new-window', '--disable-extensions', `--extensionDevelopmentPath=${repo}`, `--extensionTestsPath=${path.join(repo, 'scripts', 'livecheck', 'index.js')}`,
  `--user-data-dir=${path.join(tmp, 'udd')}`, `--extensions-dir=${path.join(tmp, 'ext')}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', ws];
spawn(code, args, { env, detached: true, stdio: 'ignore' }).unref(); // Code.exe may hand off and exit early; result.json is the signal

let result = null;
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  try { const r = JSON.parse(fs.readFileSync(resultFile, 'utf8')); if (r.finished) { result = r; break; } } catch { /* not there or half written */ }
  await sleep(1000);
}
if (!result) try { result = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch { /* never started */ }

// Only the Code.exe processes of this run: their command line names the temp folder.
const kill = `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like '*${tmp.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
await sleep(2000); // let the window close itself first
try { execFileSync('powershell', ['-NoProfile', '-Command', kill], { stdio: 'ignore' }); } catch { /* none left */ }

if (!result) { console.error(`FAIL no ${resultFile} within 90 s`); process.exit(1); }
for (const s of result.checks || []) console.log(`${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.ok ? '' : `: ${s.detail}`}`);
for (const e of result.errors || []) console.log(`ERROR ${e}`);
if (!result.finished) console.log('FAIL the test did not finish within 90 s');
for (const n of result.notes || []) console.log(`NOTE ${n}`);
const failed = !result.finished || (result.errors || []).length > 0 || (result.checks || []).some((s) => !s.ok);
console.log(`${result.passes || 0} passed, ${(result.checks || []).filter((s) => !s.ok).length} failed. ${failed ? `Full result: ${resultFile}` : ''}`);
if (!failed) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a file still locked: leave it */ }
process.exit(failed ? 1 : 0);
