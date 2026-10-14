#!/usr/bin/env node
// Keeps the read-only clones in reference/ current, from references.json.
// "nightly" follows the newest T3 nightly tag, "head" the default branch.
// Usage: node scripts/references.mjs [--yes] [--watch[=minutes]]
//   --yes    update without asking
//   --selftest  check pruneLog and exit
//   --watch  update without asking now and then every N minutes (default 20); never exits
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const refs = JSON.parse(readFileSync(join(root, "references.json"), "utf8"));
const git = (args, cwd = root) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// Nightly tags look like v0.0.46-nightly.20261011.2980: order by date, then build number.
const nightlyKey = (tag) => tag.split(".").slice(-2).map(Number);
const newerNightly = (a, b) => {
  const [da, na] = nightlyKey(a);
  const [db, nb] = nightlyKey(b);
  return da - db || na - nb;
};

function remoteTarget(ref) {
  if (ref.track === "nightly") {
    const commits = new Map();
    for (const line of git(["ls-remote", "--tags", ref.url]).split("\n")) {
      const [sha, name] = line.split("\t");
      const tag = name?.replace("refs/tags/", "");
      if (!tag?.includes("-nightly.")) continue;
      // Annotated tags list the tag object first and the commit as "^{}"; keep the commit.
      if (tag.endsWith("^{}")) commits.set(tag.slice(0, -3), sha);
      else if (!commits.has(tag)) commits.set(tag, sha);
    }
    const tag = [...commits.keys()].sort(newerNightly).at(-1);
    if (!tag) throw new Error(`no nightly tag found at ${ref.url}`);
    return { sha: commits.get(tag), label: tag, refspec: `+refs/tags/${tag}:refs/tags/${tag}` };
  }
  const sha = git(["ls-remote", ref.url, "HEAD"]).split("\t")[0];
  return { sha, label: "latest default branch", refspec: "HEAD" };
}

function localSha(dir) {
  if (!existsSync(join(dir, ".git"))) return null;
  try {
    return git(["rev-parse", "HEAD"], dir);
  } catch {
    return null;
  }
}

function update(ref, dir, target) {
  if (!existsSync(join(dir, ".git"))) {
    git(["init", "-q", dir]);
    git(["remote", "add", "origin", ref.url], dir);
  }
  // T3 contains paths longer than Windows' 260-character default limit.
  git(["config", "core.longpaths", "true"], dir);
  git(["fetch", "-q", "--depth", "1", "origin", target.refspec], dir);
  // No --force on a checked-out clone: a local edit there is a mistake we want to see.
  // A clone without HEAD only holds leftovers of an interrupted download, so force is safe.
  const force = localSha(dir) === null ? ["--force"] : [];
  git(["checkout", "-q", ...force, "--detach", "FETCH_HEAD"], dir);
  // Tools such as VS Code's Gradle import drop build caches in here; a reference stays pristine.
  git(["clean", "-q", "-f", "-d"], dir);
}

// --- Nightly drift check (docs/DRIFT.md). The log is the state: its newest block names the last reported commit,
// so a round that failed after the checkout is retried next round, and a fresh clone gets a "review every fact" block.
const t3Dir = join(root, "reference", "t3code");
const factsFile = join(root, "t3-facts.json");
const driftLog = join(root, "docs", "T3-UPDATES.md");

// git grep exits 1 for "no match"; that is an answer, not an error.
function grepFiles(text, sha, path) {
  try {
    return git(["grep", "-F", "-l", "-e", text, sha, "--", ...(path ? [path] : [])], t3Dir)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(line.indexOf(":") + 1));
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

const changedLines = (from, to, path) =>
  git(["diff", "--numstat", from, to, "--", path], t3Dir)
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => sum + line.split("\t").slice(0, 2).reduce((a, b) => a + (Number(b) || 0), 0), 0);

const nightlyTag = (sha) =>
  git(["tag", "--points-at", sha], t3Dir).split("\n").find((tag) => tag.includes("-nightly.")) || "no nightly tag";

// Keep the log small: unreviewed blocks always stay, reviewed blocks beyond the newest KEEP go; git history keeps them.
const KEEP = 3;
function pruneLog(log) {
  const [head, ...blocks] = log.split(/^(?=## )/m);
  const reviewed = blocks.filter((block) => !/^Status: unreviewed$/m.test(block));
  const drop = new Set(reviewed.slice(0, Math.max(0, reviewed.length - KEEP)));
  return head + blocks.filter((block) => !drop.has(block)).join("");
}
if (process.argv.includes("--selftest")) {
  const b = (name, status) => `## ${name}\n\n- x\n\nStatus: ${status}\n\n`;
  const out = pruneLog("# h\n\n" + b("a", "reviewed") + b("b", "unreviewed") + b("c", "reviewed") + b("d", "reviewed") + b("e", "reviewed"));
  const kept = [...out.matchAll(/^## (\w+)$/gm)].map((m) => m[1]).join("");
  if (!out.startsWith("# h\n\n") || kept !== "bcde") throw new Error(`pruneLog kept ${kept}`);
  console.log("pruneLog ok");
  process.exit(0);
}

function nag(log) {
  const n = (log.match(/^Status: unreviewed$/gm) || []).length;
  if (n) console.log(`${time()} ${n} T3 bump(s) await review: docs/T3-UPDATES.md`);
}

function driftCheck() {
  const head = localSha(t3Dir);
  if (!head) return;
  const log = existsSync(driftLog) ? readFileSync(driftLog, "utf8") : "";
  const last = [...log.matchAll(/^## .*-> ([0-9a-f]{12})\b/gm)].at(-1)?.[1] ?? null;
  if (last && head.startsWith(last)) return nag(log);

  let oldOk = false;
  if (last) {
    try {
      git(["cat-file", "-e", `${last}^{commit}`], t3Dir);
      oldOk = true;
    } catch {}
  }
  const lines = [];
  const changed = new Map(); // path -> { n, ids }: one line per file, the ids say which facts live there
  const live = [];
  let unchanged = 0;
  for (const fact of JSON.parse(readFileSync(factsFile, "utf8"))) {
    if (fact.live) {
      live.push(fact.id);
    } else if (grepFiles(fact.grep, head, fact.path).length === 0) {
      const elsewhere = grepFiles(fact.grep, head);
      lines.push(
        `- ${elsewhere.length ? "moved?" : "GONE:"} ${fact.id} (${fact.used}): "${fact.grep}" is not in ${fact.path}` +
          (elsewhere.length ? `; now in ${elsewhere.join(", ")}` : ""),
      );
    } else if (!oldOk) {
      lines.push(`- check: ${fact.id} in ${fact.path}: no earlier commit to diff against`);
    } else {
      const n = changed.get(fact.path)?.n ?? changedLines(last, head, fact.path);
      if (n) changed.set(fact.path, { n, ids: [...(changed.get(fact.path)?.ids ?? []), fact.id] });
      else unchanged++;
    }
  }
  for (const [path, { n, ids }] of changed) lines.push(`- changed ${n} lines in ${path}: ${ids.join(", ")}`);
  if (live.length) lines.push(`- re-check live: ${live.join(", ")} (each one is spelled out in t3-facts.json)`);
  const touched = [...changed.keys()];
  const from = oldOk ? `${last} (${nightlyTag(last)})` : last ? `${last} (objects missing, review every fact)` : "none (review every fact)";
  const stamp = new Date().toLocaleString("sv"); // "sv" locale prints ISO-like local time: 2026-10-12 16:05:33
  const header = `## ${stamp} t3code ${from} -> ${head.slice(0, 12)} (${nightlyTag(head)})`;
  const diffCmd = touched.length ? `git -C reference/t3code diff ${last} ${head.slice(0, 12)} -- ${touched.join(" ")}` : null;
  if (diffCmd) lines.push(`- diff: ${diffCmd}`);
  const block = `\n${header}\n\n${lines.join("\n")}\n- ${unchanged} facts unchanged\n\nStatus: unreviewed\n`;
  const intro = "# T3 nightly bumps\n\nWritten by scripts/references.mjs after every reference/t3code move (design: docs/DRIFT.md). Newest block last. A review ends a block by editing its Status line: at most three short sentences. The updater drops reviewed blocks beyond the newest three; git history keeps them.\n";
  writeFileSync(driftLog, pruneLog((log || intro) + block));
  // One message to paste to the AI; the block in the log holds the details.
  const broken =
    lines.filter((line) => /^- (moved\?|GONE:|check:)/.test(line)).length +
    [...changed.values()].reduce((sum, { ids }) => sum + ids.length, 0);
  console.log(`\n${header.slice(3)}`);
  console.log(
    broken
      ? `Paste this to the AI:\n  T3 nightly moved to ${nightlyTag(head)} and ${broken} thing(s) we rely on changed. Read the newest block in docs/T3-UPDATES.md` +
          (diffCmd ? `, run \`${diffCmd}\`` : "") +
          `, fix what broke in our code or docs, then set that block's Status line to reviewed.\n`
      : `Nothing we watch in the source changed. The block lists the live-only facts to re-check; set its Status line to reviewed when done.\n`,
  );
  nag(log + block);
}

const drift = () => {
  try {
    driftCheck();
  } catch (error) {
    console.error(`${time()} Drift check failed: ${errorText(error)}`);
  }
};

async function check(auto) {
  drift();
  const stale = [];
  for (const ref of refs) {
    const dir = join(root, "reference", ref.name);
    const target = remoteTarget(ref);
    const current = localSha(dir);
    if (current !== target.sha) stale.push({ ref, dir, target, current });
  }

  if (stale.length === 0) {
    console.log(`${time()} References are up to date.`);
    return;
  }

  console.log(`${time()} Reference updates available:`);
  for (const { ref, target, current } of stale) {
    const from = current ? current.slice(0, 8) : "not downloaded";
    console.log(`  ${ref.name}: ${from} -> ${target.sha.slice(0, 8)} (${target.label})`);
  }

  if (!auto) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Download them now? [Y/n] ")).trim().toLowerCase();
    rl.close();
    if (answer === "n" || answer === "no") {
      console.log("Skipped. Run the task 'References: update now' later.");
      return;
    }
  }

  for (const { ref, dir, target } of stale) {
    process.stdout.write(`Updating ${ref.name}... `);
    update(ref, dir, target);
    console.log("done");
  }
  drift();
}

const time = () => new Date().toLocaleTimeString();
const errorText = (error) => error.stderr?.toString().trim() || error.message;

const watchArg = process.argv.find((arg) => arg.startsWith("--watch"));
if (watchArg) {
  const minutes = Number(watchArg.split("=")[1] ?? 20);
  if (!(minutes >= 1)) throw new Error("--watch needs a number of minutes of at least 1");
  // A failed round (offline, GitHub down) is logged and retried next round, never fatal.
  const round = () =>
    check(true).catch((error) => console.error(`${time()} Reference update failed: ${errorText(error)}`));
  await round();
  setInterval(round, minutes * 60_000);
} else {
  check(process.argv.includes("--yes")).catch(async (error) => {
    console.error(`
Reference update failed: ${errorText(error)}`);
    process.exitCode = 1;
    // The startup task closes its terminal on exit; hold it open so the error is readable.
    if (process.stdin.isTTY && !process.argv.includes("--yes")) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question("Press Enter to close.");
      rl.close();
    }
  });
}
