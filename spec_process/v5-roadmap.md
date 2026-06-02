# LiteWikiagent v5 Roadmap

Date: 2026-06-02

## Product Direction

LiteWikiagent should become an agent-callable second-brain CLI.

The primary user is not only a human reading Markdown. The primary user is also an autonomous coding/research agent that needs to:

- ingest raw documents;
- inspect generated wiki;
- search prior knowledge;
- ask source-grounded questions;
- generate inspiration;
- know when evidence is missing;
- avoid treating speculation as fact.

The initial product should remain filesystem-first. The graph layer should not be implemented too early, but all wiki nodes should preserve fields that make graph construction possible later.

## Phase 1: Stabilize v5 File Contract

Goal: make every generated wiki node audit-clean and graph-ready.

Tasks:

1. Enforce compile output kinds against the active policy.
   - Conservative mode should not generate `insight`, `question`, or `counter` nodes from LLM compile output unless explicitly allowed.
   - System-generated `counter` nodes are allowed because they are derived from confirmed propositions.

2. Add tests for compile path normalization.
   - Strip leading `/`.
   - Prevent duplicate file paths.
   - Reject unsupported directories.

3. Add tests for frontmatter validation.
   - missing `nodeId`
   - missing `sourceChase`
   - missing `chunkRefs`
   - verified node without evidence

4. Keep `raw/chase` as the mandatory audit layer.
   - All wiki nodes must point to chase.
   - Chase chunk markers are the source of audit truth.

Success criteria:

```text
npm run typecheck
npx vitest run
npm run build
node dist/cli.js audit --json -> ok=true
```

## Phase 2: Strengthen Ingest Quality

Goal: reduce semantic drift and improve node usefulness.

Tasks:

1. Improve compile prompt constraints.
   - Every node must map to one or more confirmed propositions.
   - A node cannot introduce a new central claim that was not in confirmed propositions.
   - `Interpretation` can explain, but must not smuggle in unsupported claims.
   - `Limits` must state required assumptions.

2. Add a proposition-to-node coverage table.
   - Each confirmed proposition should be covered by at least one wiki node.
   - Each wiki node should reference which propositions it came from.
   - This can be a future frontmatter field such as `propRefs`.

3. Add semantic drift audit.
   - Lightweight version: LLM judge compares claim against source excerpt and returns `aligned | stretched | unsupported`.
   - Filesystem version: check if claim/evidence terms overlap enough for warning-level signals.

4. Add sample corpus.
   - PDF: `e 的基本画像`
   - MD: Karpathy/autoresearch article
   - TeX: `raw/original/tex/arXiv-1503.02531v1`

Success criteria:

- ingest succeeds for PDF, MD, and TeX;
- audit passes;
- manual spot check finds no large semantic drift;
- generated node count and kind distribution match expectations.

## Phase 3: Make Query Agent-Grade

Goal: let external agents safely use wiki as a knowledge source.

Tasks:

1. Improve query context packing.
   - prioritize high-score nodes;
   - include claim, evidence, limits, and source refs;
   - avoid overloading the prompt with low-score nodes.

2. Strengthen inference extraction.
   - capture Chinese and English inference markers;
   - separate `answer`, `sources`, `inferences`, and `missingEvidence`;
   - make missing evidence explicit when query goes beyond wiki.

3. Add query tests with mocked model output.
   - source extraction;
   - inference extraction;
   - missing evidence extraction;
   - JSON output stability.

4. Add CLI examples for agents.
   - `litewiki search`
   - `litewiki query`
   - `litewiki audit`
   - `litewiki ingest --auto --policy conservative --json`

Success criteria:

- query answers cite source nodes;
- inference is machine-readable;
- missing evidence is machine-readable;
- command output remains stable JSON.

## Phase 4: Rebuild Inspire

Goal: make `inspire` a real second-brain function, not random page recall.

Current state:

- `inspire` returns a random or simple sampled node.
- This is useful as a smoke test but not enough for the product vision.

Target behavior:

```json
{
  "seed": {},
  "related": [],
  "tensions": [],
  "counterAngles": [],
  "analogies": [],
  "nextActions": [],
  "missingEvidence": []
}
```

Tasks:

1. Seed selection.
   - support `--seed <query>`;
   - support random seed only as fallback;
   - support selecting from recent wiki nodes.

2. Related-node retrieval.
   - lexical related nodes first;
   - later graph-related nodes.

3. Tension detection.
   - compare claims and limits;
   - surface contradictions, scope gaps, assumption differences.

4. Counter-angle integration.
   - read `kind: counter` nodes;
   - include counter perspectives in inspiration output.

5. Next actions.
   - suggest what raw material to add;
   - suggest what question to ask;
   - suggest what wiki node needs review.

Success criteria:

- `inspire --json` returns structured, agent-usable output;
- it uses source-backed nodes;
- it does not invent unsupported claims without labeling them.

## Phase 5: Prepare Graph Window

Goal: preserve a clean path to graph features when wiki becomes large.

Do not implement the full graph product yet.

Instead, preserve graph-ready fields:

- `nodeId`
- `kind`
- `sourceIds`
- `sourceChase`
- `chunkRefs`
- `tags`
- `related`
- future `propRefs`
- future `claimHash`
- future `embeddingId`

Future graph capabilities:

- source-to-node graph;
- node-to-node semantic links;
- contradiction/tension edges;
- recurring concept clusters;
- hypothesis graph;
- agent memory traversal;
- inspiration from multi-hop relations.

Near-term graph preparation tasks:

1. Make `index.json` a stable manifest.
2. Add `related` generation rules.
3. Add claim hashes to avoid duplicate concepts.
4. Keep all node IDs stable and slug-safe.

Success criteria:

- a future graph importer can build nodes and source edges from files without re-calling the LLM;
- graph implementation remains optional.

## Phase 6: CLI Contract for External Agents

Goal: make LiteWikiagent easy and safe for other agents to call.

Tasks:

1. Stable JSON output for all core commands.
   - `ingest`
   - `audit`
   - `search`
   - `query`
   - `inspire`
   - `plan`

2. Machine-readable errors.
   - missing API key;
   - load failure;
   - extract failure;
   - compile failure;
   - audit failure.

3. Non-interactive defaults.
   - `--auto`
   - `--policy conservative`
   - `--json`

4. Agent usage doc.
   - command examples;
   - expected JSON shapes;
   - recommended policy choices;
   - when to run audit before query.

Success criteria:

- another agent can call the CLI without parsing human logs;
- errors are actionable;
- audit is part of the recommended workflow.

## Suggested Next Sprint

Recommended order:

1. Fix policy-vs-compile mismatch.
2. Add compile parser/path tests.
3. Run PDF, MD, and TeX ingest as a three-format e2e suite.
4. Rebuild `inspire --json` into structured output.
5. Add an agent-facing CLI contract document.

This keeps momentum on the actual product vision: a reliable, traceable second-brain CLI that agents can call freely.

