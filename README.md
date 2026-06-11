<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./image/logo-dark.svg">
    <img alt="LiteWikiagent" src="./image/logo-light.svg" width="360px">
  </picture>
  <p style="margin-top: 12px; font-size: 15px; color: #52525b;">
    Agent-first knowledge compiler — turn raw files into an auditable wiki your LLM can reason on.
  </p>
</div>

<p align="center">
  <a href="./LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-0D5C41?style=flat-square" /></a>
  <a href="#"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" /></a>
  <a href="#"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square" /></a>
  <a href="#"><img alt="DeepSeek" src="https://img.shields.io/badge/LLM-DeepSeek-00D97E?style=flat-square" /></a>
  <br />
  <br />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#core-concepts">Core Concepts</a>
  ·
  <a href="#cli-reference">CLI Reference</a>
  ·
  <a href="#development">Development</a>
  ·
  <a href="./helper/human/helper.md">User Guide</a>
  ·
  <a href="./spec/lite_llmwiki_v6.0.md">Spec (v6)</a>
</p>

---

<details>
<summary><b>Table of contents</b> (click to expand)</summary>

- [Philosophy](#philosophy)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [CLI Reference](#cli-reference)
  - [Common flags](#common-flags)
  - [Ingest](#ingest)
  - [Audit](#audit)
  - [Search](#search)
  - [Query](#query)
  - [Inspire](#inspire)
- [Ingest Policies](#ingest-policies)
- [Project Structure](#project-structure)
- [Development](#development)
- [License](#license)

</details>

---

## Philosophy

LiteWikiagent treats your wiki as a **board position** — not a textbook.

```text
You choose the material → System faithfully compiles → Wiki becomes the board → LLM plays the game
```

There are no AI gatekeepers deciding what's "worth indexing." The quality gate is the **audit**, not the ingest. Every wiki node must carry verifiable evidence back to the source.

**What this means in practice:**
- Ingest is frictionless — drop files in `raw/original/` and they're in
- The wiki is structural, not generative — claims, evidence, limits, counter-angles
- Query modes are board orientations, not prompt templates — `ask`, `trace`, `expand`, `challenge`
- LLMs reason **within** your knowledge structure, not on top of a loose vector soup

> [!NOTE]
> LiteWikiagent is built for DeepSeek (via API key). It runs entirely on your filesystem — no cloud sync, no SaaS lock-in.

---

## Quick Start

```bash
# 1. Clone and install
cd lite-llmwiki
npm install
npm run build

# 2. Set your API key
export DEEPSEEK_API_KEY=sk-your-key-here

# 3. Drop some files into raw/original/
#    Supports: .md / .pdf / .tex (full project folders)

# 4. Ingest your first document
llmwiki ingest ../raw/original/md/my-note.md --auto --policy conservative --json

# 5. Audit to verify
llmwiki audit

# 6. Query your knowledge
llmwiki query "what does the paper say about failure probability?" --mode trace --json
```

---

## Core Concepts

### The Pipeline

```text
raw/original/     ──→   raw/chase/    ──→   wiki/    ──→   audit → search → query → inspire
(what you drop)        (cleaned markdown)    (knowledge nodes)   (verify & use)
```

| Layer | Location | Purpose |
|-------|----------|---------|
| **Raw** | `raw/original/<format>/` | Source material — PDF, Markdown, TeX |
| **Chase** | `raw/chase/` | Cleaned Markdown audit trail — the exact text the LLM worked from |
| **Wiki** | `wiki/` | Structured knowledge nodes with `Claim`, `Evidence`, `chunkRefs` |

### Wiki Node Types

Each node links back to its source via `sourceChase` + `chunkRefs`:

| Kind | Purpose |
|------|---------|
| `concept` | Atomic knowledge atom — definitions, topics |
| `claim` | A specific assertion with evidence |
| `method` | A reproducible procedure or technique |
| `case` | A concrete example or instance |
| `equation` | A formula with explanation |
| `question` | An open problem raised in the source |
| `insight` | A synthesized observation across sources |
| `counter` | A conflicting or contrarian view |

### The Audit Guarantee

A wiki is **not trustworthy** until audit passes:

```text
PASS
coverage: 100%
missing evidence: 0
invalid chunkRef: 0
```

> [!WARNING]
> If audit shows missing evidence or invalid chunk references, do **not** trust query answers until the affected nodes are fixed.

---

## CLI Reference

### Common flags

| Flag | Type | Description |
|------|------|-------------|
| `--json` | boolean | Output structured JSON (use when piping to scripts) |
| `--auto` | boolean | Skip interactive prompts |
| `--policy` | enum | `conservative` (default) / `balanced` / `expansive` |

### Ingest

```bash
# Interactive
llmwiki ingest ../raw/original/pdf/economics-of-e.pdf

# Non-interactive (recommended for automation)
llmwiki ingest ../raw/original/pdf/economics-of-e.pdf --auto --policy conservative --json

# TeX project folder
llmwiki ingest ../raw/original/tex/arXiv-1503.02531v1 --auto --policy conservative --json
```

Converts raw documents into structured wiki nodes. The ingest engine:
1. Extracts clean Markdown into `raw/chase/`
2. Generates wiki nodes by node type
3. Links every node back to its source chunks

### Audit

```bash
# Structural audit (fast, no API call)
llmwiki audit --json

# Semantic audit (LLM-powered, checks for drift)
llmwiki audit --semantic --json
```

| Level | What it checks | API cost |
|-------|---------------|----------|
| `audit` | nodeId, kind, sourceChase, chunkRefs, Claim, Evidence sections | None |
| `audit --semantic` | All of the above + semantic faithfulness of claims to source | 1 API call |

### Search

```bash
llmwiki search "1/e failure probability" --json
```

Local, fast, no API call. Searches wiki nodes by keyword match.

### Query

```bash
# Ask a direct question
llmwiki query "why is 1/e the baseline for failure probability?" --mode ask --json

# Trace where a claim comes from
llmwiki query "where does this concept originate?" --mode trace --json

# Explore alternative interpretations
llmwiki query "how else to interpret this result?" --mode expand --json

# Challenge a conclusion
llmwiki query "does this reasoning hold up under scrutiny?" --mode challenge --json
```

| Mode | Board orientation | What it does |
|------|-------------------|-------------|
| `ask` | Direct recall | Pulls relevant wiki nodes, synthesizes an answer |
| `trace` | Provenance check | Follows `sourceChase` + `chunkRefs` to origin |
| `expand` | Divergent thinking | Explores adjacent nodes, counters, questions |
| `challenge` | Stress test | Looks for limits, contradictions, missing evidence |

> [!NOTE]
> Query modes are **not** prompt templates. They are board orientations — they control which wiki nodes are recalled and how the evidence is presented to the LLM.

### Inspire

```bash
llmwiki inspire --json
```

Surfaces unexpected connections across your wiki. Useful for serendipitous discovery.

> [!WARNING]
> `inspire` is currently a basic node-sampling mechanism, not a full structured inspiration engine. See [v6 spec](./spec/lite_llmwiki_v6.0.md) for the roadmap.

---

## Ingest Policies

The policy controls how aggressively the ingest engine generates wiki nodes:

| Policy | Behavior | Best for |
|--------|----------|----------|
| `conservative` | Facts only — concepts, methods, cases, equations, evidence-backed claims | Daily use, building reliable knowledge |
| `balanced` | Conservative + some synthesis and interpretation | When you want useful summaries |
| `expansive` | Full exploration — insights, questions, counter-perspectives | Discovery, brainstorming, not baseline |

---

## Project Structure

```text
LiteWikiagent/
├── image/                  # Brand assets (logo, icons, color palette)
├── lite-llmwiki/           # TypeScript CLI package
│   ├── src/                # Source code
│   └── tests/              # Test suite
├── raw/                    # Your knowledge files (gitignored)
│   ├── original/           #   Raw source material
│   │   ├── md/             #     Markdown notes
│   │   ├── pdf/            #     PDF documents
│   │   └── tex/            #     TeX project folders
│   └── chase/              #   Cleaned Markdown (auto-generated)
├── wiki/                   # Compiled knowledge nodes (auto-generated)
├── spec/                   # Design specifications & architecture
├── spec_process/           # Implementation reviews & roadmap
├── helper/                 # User & agent usage guides
│   ├── human/              #   For end users
│   └── agent/              #   For AI agents using the API
└── scripts/                # Utility scripts
```

---

## Development

```bash
cd lite-llmwiki

# Install
npm install

# Type check
npm run typecheck

# Run tests
npm run test

# Build
npm run build

# Dev mode (run CLI directly)
npm run dev -- ingest ../raw/original/md/test.md --auto --policy conservative --json
```

---

## License

MIT © LiteWikiagent contributors.

---

<p align="center">
  <sub>
    Built with the philosophy that <b>LLMs are chess players</b> — give them a board, not a textbook.
  </sub>
</p>
