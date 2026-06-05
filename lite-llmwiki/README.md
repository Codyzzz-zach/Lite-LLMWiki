# lite-llmwiki

DeepSeek-native filesystem second-brain CLI.

`lite-llmwiki` turns raw knowledge files into a traceable Markdown wiki that agents can search, audit, query, and use for inspiration. It is designed for workflows where tools such as Codex, Claude Code, opencode, or other coding/research agents call the CLI directly.

## Current Goal

The product is moving toward **v6 (board-driven agent substrate)**:

```text
raw/original -> loader/cleaning -> raw/chase -> extract -> policy confirm
            -> compile -> wiki -> audit/semantic-audit/board/query/inspire
```

The contract is not only "generate notes". The wiki must remain tied to source material AND be inspectable by agent flows:

- raw files are preserved by format;
- cleaned Markdown is preserved in `raw/chase` with stable chunk markers (v5 `<!-- chunk:N -->` and v6 `<!-- chunk N -->` both supported);
- wiki nodes point back to `sourceChase` and `chunkRefs`;
- `audit` 结构审查 verifies nodes are evidence-backed;
- `audit --semantic` adds LLM-judge semantic faithfulness check;
- `query --mode <board-mode>` assembles a QueryBoard (ask/trace/expand/compare/challenge/inspire) deterministically before any LLM call;
- output is layered: `fromWiki` (sourced) / `modelSynthesis` (inferred) / `missingEvidence`.

## Install

```bash
cd lite-llmwiki
npm install
npm run build
```

Set the API key:

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

Run the CLI from source during development:

```bash
npm run dev -- ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
```

Or after build:

```bash
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
```

## Project Structure

Runtime knowledge data lives at the repository root:

```text
raw/
  original/
    md/
    pdf/
    tex/
      <paper-project-folder>/
  chase/
wiki/
  concepts/
  methods/
  cases/
  equations/
  questions/
  insights/
  anchors/
  counters/
spec/
spec_process/
lite-llmwiki/
```

Meaning:

- `raw/original/<format>/` stores original source material by format.
- `raw/original/tex/<paper-project-folder>/` stores an entire TeX paper project, because one paper usually contains many `.tex` files.
- `raw/chase/` stores cleaned Markdown that was sent into the LLM pipeline.
- `wiki/` stores generated v5 wiki nodes.
- `spec/` stores design specifications.
- `spec_process/` stores implementation reviews, process notes, and roadmaps.
- `lite-llmwiki/` stores the TypeScript CLI package.

`raw/` and `wiki/` are local knowledge workspaces and are gitignored by default. The remote repository should preserve the structure and code contract, not personal generated knowledge files.

## Input Formats

| Format | Handling | Notes |
| --- | --- | --- |
| Markdown | loaded directly, chunked, written to chase | best for notes and reports |
| PDF | extracted and cleaned into Markdown, written to chase | useful for short documents and PDFs without TeX source |
| TeX file | resolved as a TeX source | suitable for simple papers |
| TeX folder | detects main `.tex`, resolves included files, written as one source unit | preferred for papers with many `.tex` files |

## Wiki Node Contract

v5 + v6 wiki nodes use Markdown frontmatter plus fixed body sections. v6 adds optional audit + board-context fields; v5 nodes are still valid.

Required frontmatter fields:

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
  - example
createdAt: "2026-06-02T00:00:00.000Z"
updatedAt: "2026-06-02T00:00:00.000Z"
# v6 optional fields (auto-computed by parser when possible)
auditStatus: pending      # pending | passed | warning | failed (default: pending)
auditScore: 0.92
claimType: source_claim    # source_claim | interpretation | application | analogy | question | counter
inferenceLevel: none       # none | light | medium | strong
propRefs: []               # confirmed proposition ids
claimHash: auto-computed   # sha256(normalized claim)[:16] — auto-filled by parser
boardRoles:               # 该节点在 board 中的角色
  - evidence
  - concept
```

Supported `kind` values:

```text
concept | claim | method | case | equation | question | insight | anchor | counter
```

Body sections:

```text
## Claim
## Evidence
## Interpretation
## Use For
## Limits
## Links
# v6 新增（spec 6.3）
## Audit Notes   # semantic audit 的人类可读说明
## Board Use     # 该节点适合的 query 局面
```

`audit` verifies that `sourceChase` exists, `chunkRefs` are valid, and evidence exists. `audit --semantic` adds an LLM-judge layer that scores each node's faithfulness to its chase excerpts.

## Query Board (v6)

`query --mode <mode>` assembles a deterministic `QueryBoard` before any LLM call. Six modes (aliases in parens):

| Mode | Aliases | What it assembles |
|---|---|---|
| `ask` | — | top relevant nodes + minimal extras (default) |
| `trace` | `exact` | ask + chase excerpts + source/chunkRefs |
| `expand` | `explore` | seed + methods/cases/equations + anchors/questions |
| `compare` | — | 2+ groups of seeds (per source) + bridges |
| `challenge` | `counter` | target + limits + counters + gaps |
| `inspire` | — | seed + insights/questions/counters/anchors + bridges |

`QueryBoard.instructions` carries a `BoardInstruction` that tells the LLM:
- mode name
- `synthesisLevel`: `free` | `anchored` | `strict`
- `outputBoundaries`: `{requireLayeredOutput, requireChunkRef, requireEvidenceBoundary}`

`QueryResultV6` output shape:

```json
{
  "ok": true,
  "mode": "ask",
  "question": "...",
  "answer": "...",
  "fromWiki": [{ "claim": "...", "nodeId": "...", "filePath": "...", "chunkRefs": [1] }],
  "modelSynthesis": [{ "text": "...", "basedOn": ["node-a"], "confidence": "medium" }],
  "missingEvidence": [{ "question": "...", "reason": "..." }],
  "suggestedNextActions": [{ "action": "ingest more material", "reason": "..." }],
  "board": { ... },
  "boardSummary": { ... },
  "usage": null
}
```

Agent failure shape (spec 11.3):

```json
{ "ok": false, "stage": "semantic-audit", "error": "...", "blockingIssues": [], "suggestedNextActions": [] }
```

## CLI Commands

### Ingest

```bash
llmwiki ingest <path>
```

Useful options:

```text
-m, --anchor <text>      human anchor/question
-t, --thread <id>        "all" or a thread number
--auto                   non-interactive confirmation
--policy <name>          conservative | balanced | expansive
--json                   machine-readable output
--dry-run                write chase only, do not write wiki
```

Recommended agent-safe ingest:

```bash
llmwiki ingest <path> --auto --policy conservative --json
```

### Audit

```bash
llmwiki audit --json              # 结构 audit（不调 LLM）
llmwiki audit --semantic --json   # 结构 + LLM judge 语义审查
llmwiki audit --source <id> --json
llmwiki audit --node <nodeId> --json
```

Structure audit verifies `sourceChase` exists, `chunkRefs` are valid, and evidence exists. `--semantic` adds an LLM-judge pass on each node that scores faithfulness to the chase excerpts. Without `DEEPSEEK_API_KEY`, `--semantic` returns the agent failure shape with `stage: "semantic-audit"`.

### Search

```bash
llmwiki search "1/e 失败概率" --json
```

Returns structured matches with `nodeId`, `kind`, `title`, `filePath`, `claim`, `evidence`, `interpretation`, `limits`, `useFor`, `sourceIds`, `sourceChase`, `chunkRefs`, `related`, `tags`, `auditStatus`, `auditScore` (v6 extension).

### Query

```bash
llmwiki query "为什么 1/e 可以作为失败概率基线？" --mode ask --json
llmwiki query "这个判断从哪来？" --mode trace --with-source --json
llmwiki query "基于这个观点还能怎么理解？" --mode expand --json
```

Output (v6 `QueryResultV6`):

- `board` (deterministic QueryBoard)
- `boardSummary` (lightweight counts)
- `fromWiki` (sourced claims)
- `modelSynthesis` (LLM inference, with `basedOn`)
- `missingEvidence` (gaps)
- `suggestedNextActions` (heuristic)
- `usage` (token counts, or `null` for board-only)

### Inspire

```bash
llmwiki inspire --json                        # 随机抽一个
llmwiki inspire --seed "1/e" --json            # 文本 seed
llmwiki inspire --node <nodeId> --json        # 强制 anchor
llmwiki inspire --kind concept --tags math --json
```

Output:

- `seed` (anchor)
- `connections` / `hypotheses` / `questions` / `actions` / `missingEvidence` (each item has `basedOn` + `evidenceBoundary`)
- `anchors` (filtered)

Planned v5 target: structured inspiration with seed, related nodes, tensions, counter angles, analogies, next actions, and missing evidence.

### Other Commands

```bash
llmwiki status
llmwiki node <id>
llmwiki plan <path>
llmwiki chat
```

## Development

```bash
npm run typecheck
npm run test
npm run build
```

Current validated baseline (v6):

```text
typecheck passed
204 tests passed
build passed
```

## v6 Spec & Process

- Spec: `../spec/lite_llmwiki_v6.0.md`
- Plan: `../spec_process/v6-optimization-plan.md`

v6 ships: shared parser/chase resolver, v6 frontmatter (auto-filled `claimHash` + default `auditStatus: pending`), `audit --semantic`, 6-mode Query Board, `QueryResultV6` layered output, board-driven inspire, agent failure JSON contract, graph-ready `IndexEntryV6`.

Working now:

- PDF/MD/TeX entry shape is defined.
- chase layer is preserved.
- v5 nodes are auditable.
- `audit/search/query` are usable for a basic agent second-brain loop.

Still planned:

- stricter policy-vs-compile enforcement;
- stronger semantic drift audit;
- PDF/MD/TeX three-format e2e suite;
- structured `inspire --json`;
- stable agent CLI contract docs;
- graph-ready manifest improvements without implementing the graph layer too early.

## License

MIT
