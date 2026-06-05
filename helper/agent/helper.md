# LiteWikiagent Agent Helper

This guide is for autonomous agents. It describes how to use LiteWikiagent non-interactively and how to verify results.

## Objective

Use LiteWikiagent as a filesystem second-brain CLI:

```text
raw/original -> raw/chase -> wiki -> audit/search/query/inspire
```

Primary rule: do not trust generated wiki content until `audit --json` passes.

## Repository Layout

Assume repository root:

```text
<repo-root>
```

Package directory:

```text
<repo-root>/lite-llmwiki
```

Runtime data:

```text
raw/original/md/
raw/original/pdf/
raw/original/tex/<paper-project-folder>/
raw/chase/
wiki/
```

Important:

- `raw/` and `wiki/` are local generated/runtime data and are gitignored.
- Use `raw/original/<format>/` as the input layer.
- Use `raw/chase/` as the audit layer.
- Use `wiki/` as generated knowledge output.

## Environment Prerequisites

Run commands from:

```bash
cd <repo-root>/lite-llmwiki
```

Required:

```bash
npm install
npm run build
export DEEPSEEK_API_KEY=sk-xxx
```

Node requirement:

```text
node >= 22
```

## Command Style

Prefer built CLI:

```bash
node dist/cli.js <command>
```

Use JSON for automation:

```bash
--json
```

Use conservative policy for default automated ingest:

```bash
--auto --policy conservative --json
```

## Standard Automated Ingest Flow

### 1. Build

```bash
npm run build
```

### 2. Ingest

PDF:

```bash
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
```

Markdown:

```bash
node dist/cli.js ingest ../raw/original/md/<file>.md --auto --policy conservative --json
```

TeX folder:

```bash
node dist/cli.js ingest ../raw/original/tex/<paper-project-folder> --auto --policy conservative --json
```

Expected success shape:

```json
{
  "ok": true,
  "sourceId": "raw/pdf/example-id",
  "sourceChase": "/absolute/path/to/raw/chase/file.md",
  "created": ["wiki/concepts/example.md"],
  "updated": [],
  "skipped": [],
  "coverage": {
    "coveredChunks": 4,
    "totalChunks": 4,
    "uncoveredReasons": []
  }
}
```

Failure shape can include:

```json
{
  "ok": false,
  "created": [],
  "updated": [],
  "skipped": [],
  "coverage": {
    "uncoveredReasons": ["Extract failed: ..."]
  }
}
```

On failure, do not continue to query as if ingest succeeded.

### 3. Audit

```bash
node dist/cli.js audit --json                       # structure only (no LLM)
node dist/cli.js audit --semantic --json            # structure + LLM judge
node dist/cli.js audit --source <id> --json
node dist/cli.js audit --node <nodeId> --json
```

`audit` verifies that wiki nodes are traceable to chase and evidence-backed. `--semantic` adds an LLM-judge layer that scores each node's faithfulness: claim supported by evidence, limits preserved, citation coverage, inference correctly marked, no fabricated strong claims.

Without `DEEPSEEK_API_KEY`, `--semantic` returns the v6 failure shape (spec 11.3):

```json
{
  "ok": false,
  "stage": "semantic-audit",
  "error": "stage=semantic-audit: no LLM judge provided (missing API key or call site).",
  "blockingIssues": ["no-llm-judge"],
  "suggestedNextActions": [
    "set DEEPSEEK_API_KEY environment variable",
    "pass an llmJudge option to the CLI"
  ]
}
```

Expected pass output (structure audit):

```json
{
  "ok": true,
  "summary": {
    "nodes": 9,
    "verifiedNodes": 9,
    "missingEvidence": 0,
    "invalidChunkRefs": 0,
    "coverage": 1
  },
  "issues": []
}
```

`--semantic` adds a `semantic` field with `summary.{passed, warning, failed, averageScore}` and `issues[]` (each with `dimension: support|addition|inference|limits|citation`, `reason`, optional `suggestedFix`).

Automation gate:

```text
structure audit:
  ok must be true
  missingEvidence must be 0
  invalidChunkRefs must be 0
  coverage should be 1 for clean e2e tests

semantic audit:
  summary.failed must be 0
  issues[].severity='error' must be 0
```

The command exits with code `2` when audit fails. The agent must stop subsequent query/inspire when it receives `ok: false`.

### 4. Search

```bash
node dist/cli.js search "query terms" --json --max 10
```

Expected shape (v6 extension):

```json
{
  "matches": [
    {
      "nodeId": "bernoulli-all-fail-1e",
      "kind": "concept",
      "title": "伯努利试验全失败概率的 1/e 极限",
      "score": 6,
      "filePath": "wiki/concepts/bernoulli-all-fail-1e.md",
      "claim": "...",
      "evidence": ["**Source**: ..."],
      "interpretation": "...",
      "limits": [],
      "useFor": [],
      "sourceIds": ["raw_pdf_x-abcd"],
      "sourceChase": ["raw/chase/raw_pdf_x-abcd.md"],
      "chunkRefs": [1],
      "related": [],
      "tags": [],
      "auditStatus": "pending",
      "auditScore": null
    }
  ]
}
```

Search does not require an LLM call.

### 5. Query (v6 board-driven)

```bash
node dist/cli.js query "question" --mode ask --json
node dist/cli.js query "where does this come from" --mode trace --with-source --json
node dist/cli.js query "how else can this be interpreted" --mode expand --json
node dist/cli.js query "compare these two views" --mode compare --json
node dist/cli.js query "does this hold up" --mode challenge --json
```

Aliases: `exact→trace`, `explore→expand`, `counter→challenge`.

Output shape (v6 `QueryResultV6`):

```json
{
  "ok": true,
  "mode": "ask",
  "question": "...",
  "answer": "LLM synthesis or board-only placeholder",
  "fromWiki": [
    { "claim": "...", "nodeId": "...", "filePath": "...", "chunkRefs": [1] }
  ],
  "modelSynthesis": [
    { "text": "...", "basedOn": ["node-a", "node-b"], "confidence": "medium" }
  ],
  "missingEvidence": [
    { "question": "...", "reason": "..." }
  ],
  "suggestedNextActions": [
    { "action": "ingest more material", "reason": "..." }
  ],
  "board": { "mode": "ask", "seedNodes": [...], "...": "..." },
  "boardSummary": { "seedCount": 1, "...": "..." },
  "usage": { "promptTokens": 707, "completionTokens": 948 }
}
```

Error (v6 agent contract spec 11.3):

```json
{
  "ok": false,
  "stage": "query",
  "error": "Query failed: ...",
  "blockingIssues": [],
  "suggestedNextActions": []
}
```

Agent rules:

- `board` is assembled deterministically by `buildQueryBoard` — do not call an LLM to generate the board.
- `fromWiki` is grounded material. `modelSynthesis` is LLM inference (with `basedOn` anchors). `missingEvidence` is what the wiki doesn't cover.
- Do not cite query output as source unless it has a corresponding source node.
- Any `audit` returning `ok: false` → stop subsequent query/inspire (spec 11.2 agent contract).

### 6. Inspire (v6 board-driven)

```bash
node dist/cli.js inspire --json                        # random pick
node dist/cli.js inspire --seed "1/e" --json            # text seed
node dist/cli.js inspire --node <nodeId> --json        # force anchor
node dist/cli.js inspire --kind concept --tags math --json
```

Output shape (v6 board-driven):

```json
{
  "ok": true,
  "mode": "inspire",
  "seed": {
    "nodeId": "...",
    "kind": "method",
    "title": "...",
    "filePath": "...",
    "claim": "...",
    "text": "..."
  },
  "connections": [
    { "type": "connection", "text": "...", "basedOn": ["node-a", "node-b"], "confidence": "medium", "evidenceBoundary": "..." }
  ],
  "hypotheses": [],
  "questions": [],
  "actions": [],
  "missingEvidence": [],
  "anchors": []
}
```

Each inspire item (connections / hypotheses / questions / actions / missingEvidence) carries:
- `basedOn`: anchored wiki nodeId list
- `confidence`: low / medium / high
- `evidenceBoundary`: explicit "this is synthesis, not fact" marker

## Dry Run

Use dry run when validating loader/cleaning without writing wiki:

```bash
node dist/cli.js ingest <path> --auto --policy conservative --json --dry-run
```

Expected behavior:

- writes chase;
- does not write wiki nodes;
- returns `created` paths as planned output.

## Source-Specific Audit

Use `--source` when validating one source:

```bash
node dist/cli.js audit --json --source raw_pdf_e
```

The filter matches source/chase identifiers. Use the exact `sourceId` from ingest when possible.

## Test Commands

Before committing code changes:

```bash
npm run typecheck
npm run test
npm run build
```

Current expected baseline:

```text
26 tests passed
typecheck passed
build passed
```

If tests change, update this helper and README.

## File Contract for Generated Wiki Nodes

A valid v5 node must include:

```yaml
nodeId: stable-node-id
kind: concept
title: Node title
sourceIds:
  - raw/pdf/source-id
sourceChase:
  - raw/chase/raw_pdf_source-id.md
chunkRefs:
  - 1
confidence: 0.9
status: verified
tags:
  - tag
createdAt: "..."
updatedAt: "..."
```

Required body sections for reliable agent use:

```text
## Claim
## Evidence
```

Optional but useful:

```text
## Interpretation
## Use For
## Limits
## Links
```

Supported kinds:

```text
concept | claim | method | case | equation | question | insight | anchor | counter
```

## Automated Quality Gate

For a completed ingest, require:

```text
ingest.ok == true
audit.ok == true
audit.summary.missingEvidence == 0
audit.summary.invalidChunkRefs == 0
search returns relevant matches for expected terms
query returns at least one source for source-answerable questions
```

If any condition fails, report the failure and do not claim the wiki is reliable.

## Recommended Policies

Default:

```text
conservative
```

Use `balanced` only when the user asks for broader synthesis.

Use `expansive` only when the user explicitly asks for exploratory insight/question/counter generation.

Known issue:

- Conservative policy can still allow compile output to produce an `insight` node in some cases. Treat this as a known v5 gap and verify via audit plus manual spot check if the result matters.

## Error Handling

### Missing API Key

Expected error:

```json
{
  "ok": false,
  "error": "DEEPSEEK_API_KEY not set"
}
```

Action:

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

### Connection Error

Likely LLM API/network issue.

Action:

- retry with network access;
- if running in a sandbox, request network escalation;
- do not modify source code unless the error is reproducible without network constraints.

### Audit Failure

Action:

1. Read `issues`.
2. Inspect the reported `filePath`.
3. Check `sourceChase`.
4. Check `chunkRefs`.
5. Re-run ingest if the node is generated incorrectly.

## Git Hygiene for Agents

Do not commit:

```text
raw/
wiki/
.codebase-memory/
dist/
node_modules/
```

These are runtime, generated, or tooling artifacts unless the user explicitly asks otherwise.

Commit:

```text
lite-llmwiki/src/
lite-llmwiki/tests/
lite-llmwiki/README.md
spec/
spec_process/
helper/
```

Before commit:

```bash
git status --short
npm run typecheck
npm run test
npm run build
```

## Minimal Agent Playbook

For a new raw file:

```bash
cd <repo-root>/lite-llmwiki
npm run build
node dist/cli.js ingest <path> --auto --policy conservative --json
node dist/cli.js audit --json
# v6: structure + semantic audit (requires DEEPSEEK_API_KEY)
node dist/cli.js audit --semantic --json
node dist/cli.js search "<expected key terms>" --json --max 10
node dist/cli.js query "<source-answerable question>" --mode ask --json
```

Decision rule:

- If `ingest` and `audit` pass, the wiki is mechanically valid.
- If `audit --semantic` also passes, the wiki's claims are semantically faithful to the chase.
- If `search` and `query` return relevant source-backed results, the wiki is usable for basic second-brain retrieval.
- If `query` depends on `missingEvidence`, ask for or ingest more raw material.
- Any `audit` returning `ok: false` → stop subsequent query/inspire (spec 11.2 agent contract).

## Agent Failure Contract (spec 11.3)

All core commands (plan / ingest / audit / semantic-audit / query / inspire) on failure MUST return:

```json
{
  "ok": false,
  "stage": "<plan | ingest | audit | semantic-audit | query | inspire>",
  "error": "<error message>",
  "blockingIssues": ["..."],
  "suggestedNextActions": ["..."]
}
```

When the agent receives `ok: false` it should:
1. Read `stage` to know which step failed.
2. Read `error` to know the specific failure.
3. Read `suggestedNextActions` to know what to do next.
4. Do not retry the same command unless `suggestedNextActions` suggests so (e.g., set an env var then retry).

