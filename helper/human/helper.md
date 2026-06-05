# LiteWikiagent Human Helper

This guide is for human users. It explains what this tool can do, where files should go, and how to operate it safely.

## What This Tool Does

LiteWikiagent turns raw knowledge files into a source-traceable Markdown wiki.

It is useful when you have:

- PDFs, papers, essays, notes, or TeX source folders;
- documents you want to turn into reusable knowledge;
- a need to ask questions against your own materials;
- a need to inspect whether AI-generated wiki content stays close to the source.

The core idea is:

```text
raw file -> cleaned Markdown chase file -> structured wiki node -> audit/search/query
```

The generated wiki is not meant to be a loose summary. Each good wiki node should point back to the cleaned source text and chunk references.

## What You Can Use It For

### 1. Build a Personal Knowledge Wiki

You can ingest documents and let the tool generate atomic wiki pages:

- concepts;
- claims;
- methods;
- cases;
- equations;
- questions;
- insights;
- counter-intuitive views.

These pages are saved under `wiki/`.

### 2. Preserve an Audit Trail

The tool keeps a cleaned Markdown copy in `raw/chase/`.

This matters because PDFs and TeX files are hard to inspect directly. The chase file is the exact text layer the LLM worked from. Wiki nodes then reference:

- `sourceChase`
- `chunkRefs`
- Evidence section

This makes later review possible.

### 3. Ask Questions Against Your Wiki

After ingesting materials, you can ask:

```bash
llmwiki query "为什么 1/e 可以作为失败概率基线？"
```

The answer should include sources and distinguish supported claims from inferred claims where possible.

### 4. Search Your Second Brain

Use search when you want to find relevant notes without an LLM call:

```bash
llmwiki search "1/e 失败概率"
```

Search is local and fast.

### 5. Check Whether the Wiki Is Trustworthy

Run audit:

```bash
llmwiki audit
```

Audit checks whether generated wiki pages can be traced back to `raw/chase`.

## Recommended Folder Structure

Place raw files at the repository root:

```text
raw/
  original/
    md/
    pdf/
    tex/
      <paper-project-folder>/
  chase/
wiki/
```

Use these conventions:

- Put Markdown notes in `raw/original/md/`.
- Put PDFs in `raw/original/pdf/`.
- Put a TeX paper folder in `raw/original/tex/<paper-project-folder>/`.
- Do not manually write into `raw/chase/` unless you know what you are doing.
- Treat `wiki/` as generated output that can be audited and regenerated.

TeX note: one paper usually has many `.tex` files. Keep the whole paper folder together.

## Setup

From the package directory:

```bash
cd lite-llmwiki
npm install
npm run build
```

Set the API key:

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

If you run commands from `lite-llmwiki/`, paths to root-level raw files usually start with `../`.

## Basic Workflow

### Step 1: Put Files Into `raw/original`

Example:

```text
raw/original/pdf/e 的基本画像.pdf
raw/original/md/my-note.md
raw/original/tex/arXiv-1503.02531v1/
```

### Step 2: Ingest a File

Interactive style:

```bash
llmwiki ingest ../raw/original/pdf/e\ 的基本画像.pdf
```

Non-interactive style:

```bash
llmwiki ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
```

Recommended policy for normal use:

```text
conservative
```

It accepts mostly fact-like nodes and is less likely to over-generate speculative content.

### Step 3: Audit the Wiki

```bash
llmwiki audit
```

A good result should show:

```text
PASS
coverage: 100%
missing evidence: 0
invalid chunkRef: 0
```

If audit fails, inspect the reported file path before relying on query answers.

### Step 4: Search

```bash
llmwiki search "关键词"
```

Use search when you want to know whether the wiki already contains something.

### Step 5: Query

```bash
llmwiki query "你的问题"
```

Use query when you want the system to synthesize an answer from multiple wiki nodes.

### Step 6: Inspect Wiki Files

Open files under:

```text
wiki/concepts/
wiki/methods/
wiki/equations/
wiki/insights/
wiki/counters/
```

Each v5 node should have:

- frontmatter;
- `## Claim`;
- `## Evidence`;
- optional interpretation/use/limits sections.

## Ingest Policies

### conservative

Best default. Use for source fidelity and low semantic drift.

It prefers:

- concepts;
- methods;
- cases;
- equations;
- grounded claims.

### balanced

Use when you want more useful synthesis and can tolerate some broader interpretation.

### expansive

Use when you explicitly want exploratory output such as insights, questions, and counter angles.

Do not use expansive as the default for building a reliable knowledge base.

## Common Commands

```bash
# Build
npm run build

# Ingest PDF
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json

# Ingest Markdown
node dist/cli.js ingest ../raw/original/md/my-note.md --auto --policy conservative --json

# Ingest TeX folder
node dist/cli.js ingest ../raw/original/tex/arXiv-1503.02531v1 --auto --policy conservative --json

# Audit
node dist/cli.js audit --json

# Search
node dist/cli.js search "1/e 失败概率" --json

# Query
node dist/cli.js query "为什么 1/e 可以作为失败概率基线？" --json

# Inspiration
node dist/cli.js inspire --json
```

## How To Judge Wiki Quality

A generated wiki is usable when:

- audit passes;
- each important node has Evidence;
- claims are close to the source text;
- interpretations are clearly limited;
- query answers cite wiki sources;
- query answers identify missing evidence when needed.

Warning signs:

- audit reports missing evidence;
- audit reports invalid chunk refs;
- a node has a broad claim but weak evidence;
- query answers make claims not present in sources;
- many pages are generated from a small document without clear evidence.

## Current Limitations

The current system is usable but not finished as a full v5 second-brain product.

Known limitations:

- `inspire` is still basic node sampling, not a full structured inspiration engine.
- conservative policy and compile output can still drift in edge cases.
- cross-document linking is limited.
- graph features are not implemented yet.
- semantic drift audit is not yet fully automated.

For reliable use, prefer:

```text
ingest -> audit -> search/query -> manual spot check
```

## Troubleshooting

### Missing API Key

Set:

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

### PDF or Query Fails With Connection Error

The command needs network access to the LLM API. Retry with network available.

### Audit Fails

Read the audit issue. Common causes:

- missing `raw/chase` file;
- bad `chunkRefs`;
- legacy wiki page;
- generated page without Evidence.

### TeX Folder Fails

Check whether the folder contains a main `.tex` file with `\documentclass`. If not, the loader falls back to the largest `.tex` file, which may be wrong.

