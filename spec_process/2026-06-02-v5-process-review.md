# LiteWikiagent v5 Process Review

Date: 2026-06-02

## Context

This round focused on whether LiteWikiagent can support the product vision:

- External agents such as Codex, Claude Code, opencode, and similar tools should be able to call the CLI.
- The CLI should transform raw knowledge materials into a wiki that can serve as a second brain.
- The generated wiki must remain traceable to raw/chase source material and avoid excessive semantic drift.
- The initial product should not implement the full graph layer, but the wiki schema must keep a future graph window open.

The main evaluation material was `raw/original/pdf/e 的基本画像.pdf`.

## Completed Work

### 1. Raw Storage Format

The raw layer now follows the intended structure:

- `raw/original/pdf/`
- `raw/original/md/`
- `raw/original/tex/<paper-project-folder>/`
- `raw/chase/`

Important detail: TeX papers are treated as project source units, not just isolated `.tex` files. A TeX paper folder can contain multiple included `.tex` files, style files, bibliography output, and a main file.

The chase layer is preserved as cleaned Markdown with chunk markers. This is useful because:

- it is the exact LLM input layer after raw parsing/cleaning;
- it allows human audit without reopening PDFs or reconstructing TeX;
- wiki nodes can reference `sourceChase` and `chunkRefs`;
- future graph/index rebuilds can inspect the stable text layer.

### 2. v5 Wiki Schema Repair

The wiki node format was aligned toward v5:

- `nodeId`
- `kind`
- `sourceIds`
- `sourceChase`
- `chunkRefs`
- `confidence`
- `status`
- `tags`
- `related`
- `createdAt`
- `updatedAt`

The renderer now validates v5-required fields and requires verified nodes to carry evidence.

Supported node kinds now include:

- `concept`
- `claim`
- `method`
- `case`
- `equation`
- `question`
- `insight`
- `anchor`
- `counter`

### 3. Evidence and Audit Improvements

Evidence now supports source-linked summaries and excerpts/quotes.

Audit now checks:

- whether v5 schema fields exist;
- whether `sourceChase` files exist;
- whether `chunkRefs` exist in the chase file;
- whether the Evidence section exists;
- whether the Claim section exists;
- whether a node is legacy or verified.

The audit result is now meaningful as a machine contract for agent usage.

### 4. Legacy Devils-Advocate Migration

The old `_devils-advocate-*` page generation was removed from the active flow.

It now generates a v5 `counter` node in:

```text
wiki/counters/counter-*.md
```

This matters because old devils-advocate pages were not schema-complete and reduced audit coverage. The new `counter` node has:

- `kind: counter`
- source IDs;
- chase path;
- chunk refs;
- evidence;
- claim;
- interpretation;
- use-for and limits.

### 5. Index Manifest Cleanup

`wiki/index.json` no longer guesses kind from old filename patterns. It now reads `kind` from frontmatter where available.

This keeps the future graph window cleaner because the manifest can become a graph import surface.

### 6. Tests Added and Verified

The filesystem golden e2e tests now include a v5 counter-node contract.

Verification passed:

```text
npm run typecheck
npx vitest run
npm run build
```

Result:

```text
26 tests passed
typecheck passed
build passed
```

## Real End-to-End Run

Command used:

```text
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
```

The sandboxed run failed due to network restrictions, then the same command was run with approved network escalation.

Result:

```json
{
  "ok": true,
  "sourceId": "raw/pdf/e 的基本画像-d22f38f18f084231",
  "coverage": {
    "coveredChunks": 4,
    "totalChunks": 4,
    "uncoveredReasons": []
  }
}
```

Generated wiki nodes:

```text
wiki/equations/1e-limit-definition.md
wiki/concepts/derangement-probability-1e.md
wiki/concepts/exponential-survival-1e.md
wiki/insights/entropy-max-point-1e.md
wiki/methods/secretary-problem-1e-law.md
wiki/methods/greedy-submodular-1minus1e.md
wiki/concepts/exponential-decay-1e-lifetime.md
wiki/concepts/bernoulli-all-fail-1e.md
wiki/counters/counter-8f084231.md
```

Generated chase:

```text
raw/chase/raw_pdf_e 的基本画像-d22f38f18f084231.md
```

## Audit Result

Command:

```text
node dist/cli.js audit --json
```

Result:

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

Interpretation:

- The v5 file contract is currently passing.
- Every generated node has evidence.
- Every generated node points back to chase.
- Every referenced chunk exists.
- The old legacy devils-advocate warning is gone.

## Search Result

Command:

```text
node dist/cli.js search "1/e 失败概率" --json
```

The search recalled the expected nodes:

- `bernoulli-all-fail-1e`
- `exponential-decay-1e-lifetime`
- `exponential-survival-1e`
- `derangement-probability-1e`
- `1e-limit-definition`
- `secretary-problem-1e-law`
- `greedy-submodular-1minus1e`
- `entropy-max-point-1e`
- `counter-8f084231`

Interpretation:

- Search is usable for basic second-brain retrieval.
- The result shape is structured enough for an agent to consume.
- Retrieval is still lexical/simple, not graph-aware.

## Query Result

Command:

```text
node dist/cli.js query "为什么 1/e 可以作为失败概率基线？" --json
```

The query succeeded with network escalation.

Observed behavior:

- The answer used wiki sources.
- The sources included relevant node IDs and file paths.
- The answer cited exponential survival, Bernoulli all-fail, derangement probability, and entropy as a supplementary angle.
- The answer separated one inference:

```text
（以上“用作阈值”、“参考基线”是基于 wiki 内容的推断，并非节点直接宣称。）
```

Interpretation:

- The query flow is now good enough for a first second-brain agent workflow.
- The model can answer from wiki instead of raw.
- It can mark at least some derived claims as inference.

## Quality Assessment

### What Is Working

The current system can complete:

```text
raw/original -> loader/cleaning -> raw/chase -> extract -> policy confirm -> compile -> wiki -> audit -> search -> query
```

For the `e 的基本画像` document, semantic drift appears controlled:

- Most claims are close to source facts.
- Evidence excerpts are traceable to chase chunks.
- Wiki nodes are atomic enough for search and query.
- The answer generated from wiki does not appear to invent a completely unrelated thesis.

The wiki can already serve as a basic second brain for:

- fact recall;
- source-grounded Q&A;
- concept lookup;
- evidence inspection;
- simple inspiration via random node sampling.

### What Is Not Yet Good Enough

The system is not yet a full v5 second-brain product.

Remaining gaps:

- `inspire` is still closer to random recall than structured inspiration.
- policy and compile are not perfectly aligned: conservative mode skipped insight propositions, but compile still produced one `insight` node.
- cross-node links are weak.
- no conflict/tension detection yet.
- no graph extraction yet, only graph-ready fields.
- no multi-document evaluation corpus yet.
- no hard semantic-drift scoring beyond audit and manual inspection.

## Completion Estimate

Current v5 direction completion:

```text
65% - 70%
```

The basic end-to-end product loop is working.

The remaining work is less about "can it run" and more about:

- making output consistently controlled;
- making agent-facing commands stronger;
- making inspiration/query behavior more second-brain-like;
- preparing the graph window without implementing graph as the first product.

