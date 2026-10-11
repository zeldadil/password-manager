#!/usr/bin/env node
/**
 * merge-guard.mjs — SEC-GATE / t_30e17642: refuse GitHub pull-request merges from
 * every Hermes profile except `architect`.
 *
 * Why: every agent pushes with the repository owner's token, so GitHub records
 * every merge as `mergedBy: zeldadil` — it cannot tell an agent's merge from a
 * human one. On 2026-10-09 dispatcher `qa` workers merged their own PRs (#124,
 * #125, probably #126) with no architect counter-verification. A written rule did
 * not stop it; this hook does. QA_SIGN_OFF_GATE.md §5.9: "the merger (the
 * architect, in practice) merges" — so the merge belongs to architect.
 *
 * Wired as a Hermes `pre_tool_call` shell hook (scripts/qa/hooks/merge-guard.sh)
 * with matcher ^(terminal|process_manage|execute_code|tool_call|mcp__.*merge.*)$
 * in every profile EXCEPT architect (scripts/qa/hooks/install-merge-guard.sh).
 *
 * What is refused (rule ids are quoted in the block reason):
 *   R_GH_PR_MERGE       `gh pr merge …` — any flags, -R/--repo before or after the
 *                       subcommand, behind env assignments / wrappers (sudo, env,
 *                       timeout, xargs, find -exec …), inside `bash -c '…'`,
 *                       `eval`, `$(…)`, backticks, heredocs fed to a shell, and
 *                       after `&&`, `||`, `;`, `|` or a newline.
 *   R_API_PULL_MERGE    any `…/pulls/<n>/merge` REST path (`gh api`, `-X PUT`,
 *                       `--method PUT`, curl, scripts) — read or write.
 *   R_API_BRANCH_MERGE  the REST branch-merge endpoint `repos/<o>/<r>/merges`, which
 *                       lands a branch on master with no pull request at all.
 *   R_GRAPHQL_MERGE     the GraphQL mutations `mergePullRequest` and
 *                       `enablePullRequestAutoMerge`.
 *   R_GH_ALIAS_MERGE    `gh alias set|import` whose expansion merges a PR (an alias
 *                       would hide the next `gh pr merge` behind a new name).
 *   R_MCP_MERGE_TOOL    an MCP tool named like `merge_pull_request` (the
 *                       `@modelcontextprotocol/server-github` server that the
 *                       `product` profile loads exposes one).
 *   R_PAYLOAD_PARSE / R_INTERNAL   fail closed on an unreadable payload / a guard bug.
 *
 * What stays allowed: `gh pr view|checks|create|list|diff|status|review`,
 * `git merge-base`, a local `git merge`, `gh pr view --json mergeable,…`, and text
 * that only *mentions* a merge command (echo/printf/grep data, a quoted
 * `git commit -m` message, a `gh pr create --body` text).
 *
 * This is a guard against an agent merging by habit or by following an old
 * runbook, not a sandbox: a determined process can still build the command at
 * run time (string concatenation, a script file run later, a browser click). The
 * residual paths are listed in tests/evidence/t_30e17642/README.md.
 *
 * Modes:
 *   hook                       read a Hermes pre_tool_call payload on stdin; print {} + exit 0
 *                              (allow) or {"decision":"block","reason":…} + exit 2 (block).
 *   check --tool NAME [--] TEXT
 *                              classify TEXT as that tool's main argument (command / code /
 *                              data); prints ALLOW or BLOCK <rules>; exit 0 / 2.
 *
 * There is deliberately no kill-switch file: any agent could create it. A false
 * positive costs one hand-off to architect; roll back by removing the hook entry
 * from the profile's config.yaml (scripts/qa/hooks/install-merge-guard.sh --help).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GUIDANCE =
  "le merge revient à architect (QA_SIGN_OFF_GATE.md §5.9 — the merger, architect in practice, merges and then " +
  "completes the card). Push your branch, open the PR with `gh pr create` (body line `Closes <card id>`), move the " +
  "card to review with `PR: #<n>`, and leave the merge to architect. Read-only commands (gh pr view/checks/list, " +
  "git merge-base) and a local `git merge` are not affected.";

const RULE_TEXT = {
  R_GH_PR_MERGE: "`gh pr merge`",
  R_API_PULL_MERGE: "REST `pulls/<n>/merge`",
  R_API_BRANCH_MERGE: "REST `repos/<o>/<r>/merges` (branch merge without a PR)",
  R_GRAPHQL_MERGE: "GraphQL merge mutation",
  R_GH_ALIAS_MERGE: "`gh alias` that merges a PR",
  R_MCP_MERGE_TOOL: "MCP merge_pull_request tool",
  R_PAYLOAD_PARSE: "unreadable hook payload (fail closed)",
  R_INTERNAL: "merge-guard internal error (fail closed)",
};

// ── Raw-text rules (applied to every guarded text, quoting ignored) ──────────
const API_MERGE_RE = /pulls\/[^/\s'"`]+\/merge(?![A-Za-z0-9_-])/i;
// POST /repos/{owner}/{repo}/merges merges a branch into another (e.g. master) with no PR at all.
const API_BRANCH_MERGE_RE = /repos\/[^/\s'"`]+\/[^/\s'"`]+\/merges(?![A-Za-z0-9_-])/i;
const GRAPHQL_MERGE_RE = /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/i;

// Loose CLI pattern for non-shell code (execute_code, python -c, heredocs fed to an
// interpreter): gh <flags…> pr <flags…> merge, with list/quote/comma separators.
const SEP = String.raw`[\s'",\[\]()]+`;
const FLAG = String.raw`(?:--?[A-Za-z][\w-]*(?:=[^\s'",\]]*)?${SEP}(?:[^\s'",\]-][^\s'",\]]*${SEP})?)`;
const LOOSE_GH_PR_MERGE_RE = new RegExp(String.raw`(?:^|[^\w.-])gh(?:\.exe)?${SEP}${FLAG}*pr${SEP}${FLAG}*merge(?![\w-])`, "i");
const LOOSE_ALIAS_RE = /(?:^|[^\w.-])gh(?:\.exe)?\b[^\n]*\balias\b[^\n]*\bpr[\s'",]+merge(?![\w-])/i;

// ── Shell model ──────────────────────────────────────────────────────────────
// Heads whose arguments are data, never executed: a mention there is not a merge.
const DATA_HEADS = new Set([
  "echo", "printf", "grep", "egrep", "fgrep", "rg", "ag", "ack", "sed", "awk", "gawk", "cat", "tac", "less",
  "more", "head", "tail", "man", "which", "type", "whereis", "tee", "wc", "sort", "uniq", "cut", "tr", "git",
  "hermes", "true", "false", ":", "test", "[", "[[", "jq", "yq", "diff", "cmp", "ls", "sha256sum", "base64",
  "read", "export", "local", "declare", "printenv",
]);
const KEYWORDS = new Set(["{", "}", "!", "then", "do", "else", "elif", "if", "while", "until", "fi", "done", "esac", "in", "function", "coproc"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "mksh", "ash", "fish"]);
const INTERPRETERS = new Set([
  "python", "python2", "python3", "node", "nodejs", "deno", "bun", "perl", "ruby", "php", "pwsh", "powershell",
  "osascript", "lua", "tclsh", "Rscript",
]);
const GH_VALUE_FLAGS = new Set(["-R", "--repo"]);
const MAX_DEPTH = 8;

const base = (word) => {
  const t = String(word).replace(/^.*[\\/]/, "");
  return /^gh\.exe$/i.test(t) ? "gh" : t;
};
const isVersioned = (name, set) => set.has(name) || set.has(name.replace(/[\d.]+$/, ""));

/** Read a `$( … )` body starting just after the opening paren. Returns [body, nextIndex]. */
function readParen(src, start) {
  let depth = 1;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\" && quote === '"') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "\\") { i++; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return [src.slice(start, i), i + 1];
  }
  return [src.slice(start), src.length];
}

/**
 * A small POSIX-ish lexer. Returns { segments, nested } where each segment is one
 * simple command: { words: [{ text, quoted, redir }], heredocs: [body], herestrings: [text] }
 * and `nested` holds command-substitution bodies ($(…) and backticks, also inside "…").
 */
export function lex(src) {
  const segments = [];
  const nested = [];
  let seg = { words: [], heredocs: [], herestrings: [] };
  let cur = null;
  let redirNext = false;
  let herestringNext = false;
  let pendingHeredocs = [];
  const n = src.length;

  const ensure = () => { if (cur === null) cur = { text: "", quoted: false, redir: false }; };
  const pushWord = () => {
    if (cur === null) return;
    if (herestringNext) { seg.herestrings.push(cur.text); herestringNext = false; }
    else { cur.redir = redirNext; seg.words.push(cur); }
    redirNext = false;
    cur = null;
  };
  const endSegment = () => {
    pushWord();
    redirNext = false;
    herestringNext = false;
    if (seg.words.length || seg.heredocs.length || seg.herestrings.length) segments.push(seg);
    seg = { words: [], heredocs: [], herestrings: [] };
  };

  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] === "\n") { i += 2; continue; }
      ensure();
      cur.text += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === "'") {
      ensure();
      cur.quoted = true;
      const j = src.indexOf("'", i + 1);
      const end = j < 0 ? n : j;
      cur.text += src.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      ensure();
      cur.quoted = true;
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) { cur.text += src[i + 1]; i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "(") {
          const [body, next] = readParen(src, i + 2);
          nested.push(body);
          cur.text += "$(…)";
          i = next;
          continue;
        }
        if (src[i] === "`") {
          const j = src.indexOf("`", i + 1);
          const end = j < 0 ? n : j;
          nested.push(src.slice(i + 1, end));
          i = end + 1;
          continue;
        }
        cur.text += src[i];
        i++;
      }
      i++;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      const [body, next] = readParen(src, i + 2);
      nested.push(body);
      ensure();
      cur.text += "$(…)";
      i = next;
      continue;
    }
    if (c === "`") {
      const j = src.indexOf("`", i + 1);
      const end = j < 0 ? n : j;
      nested.push(src.slice(i + 1, end));
      ensure();
      cur.text += "`…`";
      i = end + 1;
      continue;
    }
    if (c === "#" && cur === null) {
      const j = src.indexOf("\n", i);
      i = j < 0 ? n : j;
      continue;
    }
    if (c === "\n") {
      endSegment();
      i++;
      for (const h of pendingHeredocs) {
        const lines = [];
        while (i < n) {
          const j = src.indexOf("\n", i);
          const line = src.slice(i, j < 0 ? n : j);
          i = j < 0 ? n : j + 1;
          if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
          lines.push(line);
        }
        h.target.heredocs.push(lines.join("\n"));
      }
      pendingHeredocs = [];
      continue;
    }
    if (c === "<" && src[i + 1] === "<" && src[i + 2] === "<") {
      pushWord();
      herestringNext = true;
      i += 3;
      continue;
    }
    if (c === "<" && src[i + 1] === "<") {
      pushWord();
      let k = i + 2;
      let strip = false;
      if (src[k] === "-") { strip = true; k++; }
      while (src[k] === " " || src[k] === "\t") k++;
      let delim = "";
      while (k < n && !/[\s;&|<>()]/.test(src[k])) {
        if (src[k] === "'" || src[k] === '"') {
          const q = src[k];
          const j = src.indexOf(q, k + 1);
          const end = j < 0 ? n : j;
          delim += src.slice(k + 1, end);
          k = end + 1;
        } else if (src[k] === "\\") {
          delim += src[k + 1] ?? "";
          k += 2;
        } else {
          delim += src[k];
          k++;
        }
      }
      if (delim) pendingHeredocs.push({ delim, strip, target: seg });
      i = k;
      continue;
    }
    if (c === ">" || c === "<" || (c === "&" && src[i + 1] === ">")) {
      if (cur && !cur.quoted && /^\d+$/.test(cur.text)) cur = null; // fd number: 2>&1
      pushWord();
      let k = i + 1;
      if (c === "&") k++;
      if (src[k] === ">" || src[k] === "&" || src[k] === "|") k++;
      if (src[k] === "(") { i = k; continue; } // process substitution: <( … ) → its own segment
      redirNext = true;
      i = k;
      continue;
    }
    if (c === "|" && src[i + 1] !== "|") {
      // a pipe: the next segment reads this one's output (`echo … | bash`)
      seg.pipe = true;
      endSegment();
      i += src[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if ((c === "|" || c === "&") && src[i + 1] === c) {
      endSegment();
      i += 2;
      continue;
    }
    if (c === ";" || c === "&" || c === "(" || c === ")") {
      endSegment();
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      pushWord();
      i++;
      continue;
    }
    ensure();
    cur.text += c;
    i++;
  }
  endSegment();
  return { segments, nested };
}

/** `gh` argv after the `gh` word → rule id or null. */
function classifyGh(args) {
  const pos = [];
  for (let k = 0; k < args.length && pos.length < 3; k++) {
    const t = args[k].text;
    if (GH_VALUE_FLAGS.has(t)) { k++; continue; }
    if (t.startsWith("-")) continue;
    pos.push(t);
  }
  if (pos[0] === "pr" && pos[1] === "merge") return "R_GH_PR_MERGE";
  if (pos[0] === "alias" && (pos[1] === "set" || pos[1] === "import")) {
    const rest = args.map((w) => w.text).join(" ");
    if (/\bpr\s+merge\b/.test(rest) || API_MERGE_RE.test(rest) || GRAPHQL_MERGE_RE.test(rest)) return "R_GH_ALIAS_MERGE";
    if (pos[1] === "import") return "R_GH_ALIAS_MERGE"; // file/stdin content is invisible here: refuse
  }
  return null;
}

/** Loose detection for code that is not shell (python/node/…): returns rule ids. */
export function scanCode(text) {
  const rules = new Set(scanRaw(text));
  if (LOOSE_GH_PR_MERGE_RE.test(text)) rules.add("R_GH_PR_MERGE");
  if (LOOSE_ALIAS_RE.test(text)) rules.add("R_GH_ALIAS_MERGE");
  return [...rules];
}

/** Raw-text rules, quoting ignored. */
export function scanRaw(text) {
  const rules = [];
  if (API_MERGE_RE.test(text)) rules.push("R_API_PULL_MERGE");
  if (API_BRANCH_MERGE_RE.test(text)) rules.push("R_API_BRANCH_MERGE");
  if (GRAPHQL_MERGE_RE.test(text)) rules.push("R_GRAPHQL_MERGE");
  return rules;
}

/** Shell command text → rule ids. */
export function scanShell(text, depth = 0) {
  const rules = new Set(scanRaw(text));
  if (depth > MAX_DEPTH) {
    for (const r of scanCode(text)) rules.add(r);
    return [...rules];
  }
  const { segments, nested } = lex(text);
  for (const body of nested) for (const r of scanShell(body, depth + 1)) rules.add(r);

  const headOf = (seg) => {
    const words = seg.words.filter((w) => !w.redir);
    let h = 0;
    while (h < words.length && (KEYWORDS.has(words[h].text) || (!words[h].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[h].text)))) h++;
    const names = words.slice(h).map((w) => base(w.text));
    return {
      words,
      h,
      head: h < words.length ? base(words[h].text) : "",
      hasShell: names.some((nm) => isVersioned(nm, SHELLS)) || names[0] === "eval",
      hasInterp: names.some((nm) => isVersioned(nm, INTERPRETERS)),
    };
  };

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const { words, h, head, hasShell, hasInterp } = headOf(seg);
    if (h >= words.length && !seg.heredocs.length && !seg.herestrings.length) continue;

    // 0. Output piped into a shell / interpreter is executed: `echo 'gh pr merge 1' | bash`,
    //    `cat <<EOF | sh`. The producing segment's text is then scanned as a script.
    if (seg.pipe && segments[s + 1]) {
      const next = headOf(segments[s + 1]);
      if (next.hasShell || next.hasInterp) {
        const produced = [words.slice(h + 1).map((w) => w.text).join(" "), ...seg.heredocs, ...seg.herestrings];
        for (const body of produced) {
          if (next.hasShell) for (const r of scanShell(body, depth + 1)) rules.add(r);
          if (next.hasInterp) for (const r of scanCode(body)) rules.add(r);
        }
      }
    }

    if (DATA_HEADS.has(head)) continue; // otherwise arguments, heredoc and here-string are data

    // 1. `gh … pr merge` wherever `gh` is the command word, including behind a wrapper
    //    (sudo/env/timeout/xargs/find -exec/parallel …): any `gh` word in an executing segment.
    for (let k = h; k < words.length; k++) {
      if (base(words[k].text) !== "gh") continue;
      const r = classifyGh(words.slice(k + 1));
      if (r) rules.add(r);
    }

    // 2. command strings handed to something that runs them: bash -c '…', eval '…',
    //    watch '…', ssh host '…', su -c '…', env -S '…', parallel '…' {} — every
    //    quoted multi-word argument of a non-data, non-gh head is parsed as shell.
    //    Interpreter code (python -c '…', node -e '…') gets the loose code scan.
    if (head !== "gh") {
      for (const w of words.slice(h + 1)) {
        if (!w.quoted || !/\s/.test(w.text)) continue;
        if (hasInterp) for (const r of scanCode(w.text)) rules.add(r);
        for (const r of scanShell(w.text, depth + 1)) rules.add(r);
      }
      if (head === "eval") for (const r of scanShell(words.slice(h + 1).map((w) => w.text).join(" "), depth + 1)) rules.add(r);
    }

    // 3. heredoc / here-string bodies are executed when fed to a shell or an interpreter.
    for (const body of [...seg.heredocs, ...seg.herestrings]) {
      if (hasShell) for (const r of scanShell(body, depth + 1)) rules.add(r);
      if (hasInterp || head === "") for (const r of scanCode(body)) rules.add(r);
    }
  }
  return [...rules];
}

const MCP_MERGE_TOOL_RE = /(?:^|_)merge_?pull_?request(?:$|_)|(?:^|_)merge_pr(?:$|_)|mergepullrequest/i;

/** Evaluate one tool call. Returns a sorted list of rule ids (empty = allow). */
export function evaluateTool(toolName, input, depth = 0) {
  const name = String(toolName ?? "");
  const rules = new Set();
  const args = input && typeof input === "object" ? input : {};
  const str = (v) => (typeof v === "string" ? v : "");

  if (name.startsWith("mcp__") && MCP_MERGE_TOOL_RE.test(name)) {
    rules.add("R_MCP_MERGE_TOOL");
  }

  if (name === "terminal") {
    for (const r of scanShell(str(args.command))) rules.add(r);
  } else if (name === "process_manage" || name === "process") {
    for (const r of scanShell(str(args.data))) rules.add(r);
  } else if (name === "execute_code") {
    for (const r of scanCode(str(args.code))) rules.add(r);
  } else if (name === "tool_call") {
    const calls = Array.isArray(args.calls) ? args.calls : [];
    if (depth < 4) {
      for (const c of calls) for (const r of evaluateTool(c?.name, c?.arguments, depth + 1)) rules.add(r);
    }
  } else {
    // Any other matched tool (an MCP tool whose name mentions merge): raw rules over every string arg.
    for (const r of scanRaw(JSON.stringify(args))) rules.add(r);
  }
  return [...rules].sort();
}

export function blockReason(rules) {
  const what = rules.map((r) => `${r} (${RULE_TEXT[r] ?? r})`).join(", ");
  return `merge-guard: blocked — ${what}: ${GUIDANCE}`;
}

function pickInput(payload) {
  for (const cand of [payload?.tool_input, payload?.args, payload?.extra?.tool_input, payload?.extra?.args]) {
    if (cand && typeof cand === "object" && !Array.isArray(cand)) return cand;
  }
  return {};
}

function hookMode() {
  const block = (rules) => {
    process.stdout.write(JSON.stringify({ decision: "block", reason: blockReason(rules) }) + "\n");
    process.exit(2);
  };
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    block(["R_PAYLOAD_PARSE"]);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("not an object");
  } catch {
    block(["R_PAYLOAD_PARSE"]);
  }
  let rules;
  try {
    rules = evaluateTool(payload.tool_name, pickInput(payload));
  } catch {
    block(["R_INTERNAL"]);
  }
  if (rules.length) block(rules);
  process.stdout.write("{}\n");
  process.exit(0);
}

function checkMode(argv) {
  let tool = "terminal";
  const rest = [];
  for (let k = 0; k < argv.length; k++) {
    if (argv[k] === "--tool") { tool = argv[++k]; continue; }
    if (argv[k] === "--") { rest.push(...argv.slice(k + 1)); break; }
    rest.push(argv[k]);
  }
  const text = rest.join(" ");
  const key = { terminal: "command", process_manage: "data", execute_code: "code" }[tool] ?? "text";
  const rules = evaluateTool(tool, { [key]: text });
  console.log(rules.length ? `BLOCK ${rules.join(",")}` : "ALLOW");
  process.exit(rules.length ? 2 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2] || "hook";
  if (mode === "hook") hookMode();
  else if (mode === "check") checkMode(process.argv.slice(3));
  else {
    console.error(`merge-guard: unknown mode "${mode}" (expected hook | check)`);
    process.exit(3);
  }
}
