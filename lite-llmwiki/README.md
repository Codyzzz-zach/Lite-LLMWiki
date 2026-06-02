# lite-llmwiki

DeepSeek-native filesystem second-brain CLI.

`lite-llmwiki` turns raw knowledge files into a traceable Markdown wiki that agents can search, audit, query, and use for inspiration. It is designed for workflows where tools such as Codex, Claude Code, opencode, or other coding/research agents call the CLI directly.

## Current Goal

The product is moving toward v5:

```text
raw/original -> loader/cleaning -> raw/chase -> extract -> policy confirm -> compile -> wiki -> audit/search/query/inspire
```

The important contract is not only "generate notes". The wiki must remain tied to source material:

- raw files are preserved by format;
- cleaned Markdown is preserved in `raw/chase`;
- wiki nodes point back to `sourceChase` and `chunkRefs`;
- audit can verify whether a node is evidence-backed;
- query output can separate sourced answers from inferred claims.

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

v5 wiki nodes use Markdown frontmatter plus fixed body sections.

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
```

`audit` verifies that `sourceChase` exists, `chunkRefs` are valid, and evidence exists.

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
llmwiki audit --json
```

Checks whether generated wiki nodes are traceable to chase and evidence-backed.

### Search

```bash
llmwiki search "1/e 失败概率" --json
```

Returns structured matches with node ID, kind, title, file path, claim, and evidence.

### Query

```bash
llmwiki query "为什么 1/e 可以作为失败概率基线？" --json
```

Uses wiki search results as context and returns:

- `answer`
- `sources`
- `inferences`
- `missingEvidence`
- `usage`

### Inspire

```bash
llmwiki inspire --json
```

Current state: basic node-based inspiration/sampling.

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

Current validated baseline:

```text
typecheck passed
26 tests passed
build passed
```

## v5 Process Notes

See:

- `../spec_process/2026-06-02-v5-process-review.md`
- `../spec_process/v5-roadmap.md`

Current v5 direction completion is estimated at roughly `65% - 70%`.

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
