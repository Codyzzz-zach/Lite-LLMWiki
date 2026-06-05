# LiteWikiagent

DeepSeek-native filesystem second-brain CLI.

LiteWikiagent turns raw knowledge files (PDF, Markdown, TeX) into a traceable Markdown wiki that agents can search, audit, query, and use for inspiration.

## Quick Start

```bash
cd lite-llmwiki
npm install
npm run build
export DEEPSEEK_API_KEY=sk-your-key-here
```

## Core Flow

```text
raw/original -> raw/chase -> wiki -> audit/search/query/inspire
```

- `raw/original/<format>/` — original source material
- `raw/chase/` — cleaned Markdown (audit layer)
- `wiki/` — generated knowledge nodes

## Project Structure

```text
LiteWikiagent/
  lite-llmwiki/        # TypeScript CLI package
    src/               # source code
    tests/             # test suite
  spec/                # design specifications
    archive/           # historical spec versions
  spec_process/        # implementation reviews & roadmaps
  helper/              # usage guides for agents & humans
```

## CLI Commands

```bash
# Ingest a document
llmwiki ingest <path> --auto --policy conservative --json

# Audit the wiki
llmwiki audit --json              # structure audit
llmwiki audit --semantic --json   # structure + LLM semantic audit

# Search
llmwiki search "query terms" --json

# Query (v6 board-driven)
llmwiki query "question" --mode ask --json
llmwiki query "where does this come from?" --mode trace --json
llmwiki query "how else to interpret?" --mode expand --json
llmwiki query "does this hold up?" --mode challenge --json

# Inspire
llmwiki inspire --json
```

## Development

```bash
cd lite-llmwiki
npm run typecheck
npm run test
npm run build
```

## License

MIT
