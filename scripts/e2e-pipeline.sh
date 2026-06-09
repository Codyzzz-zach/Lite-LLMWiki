#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# e2e-pipeline.sh — E2E pipeline verification for LiteWikiagent
#
# Runs the full chain (ingest → audit → query → inspire) for each
# input format (md, pdf, tex) in isolated temporary directories,
# captures timing + output metrics, and writes baseline JSON files
# to e2e-baselines/ for long-term retention.
#
# Key design:
#   - stderr (human-readable) and stdout (JSON) are captured separately
#   - Audit is diagnostic — exit=2 does NOT block query/inspire
#   - Each scenario runs in a fresh temp directory
#   - Baselines are persisted (not deleted after run)
#
# Usage:
#   bash scripts/e2e-pipeline.sh
#
# Prerequisites:
#   - DEEPSEEK_API_KEY set (in .env or environment)
#   - Node >= 22, npm, tsx installed
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LITE_DIR="$REPO_ROOT/lite-llmwiki"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DATE_TAG=$(date +"%Y-%m-%d")
BASELINE_DIR="$REPO_ROOT/e2e-baselines"

CLI="npx tsx $LITE_DIR/src/cli/index.ts"

# ── Resolve API key ──
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  if [ -f "$LITE_DIR/.env" ]; then
    DEEPSEEK_API_KEY=$(grep '^DEEPSEEK_API_KEY=' "$LITE_DIR/.env" | head -1 | cut -d= -f2-)
    export DEEPSEEK_API_KEY
  fi
fi

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "❌ DEEPSEEK_API_KEY not set. Set it in lite-llmwiki/.env or environment."
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  LiteWikiagent E2E Pipeline Verification"
echo "  Timestamp: $TIMESTAMP"
echo "═══════════════════════════════════════════════════════"
echo ""

mkdir -p "$BASELINE_DIR"

# ── Run a CLI step: stdout → JSON file, stderr → console ──
# Returns: exit code written to _STEP_EXIT, ms to _STEP_MS
run_cli_step() {
  local label="$1"
  local json_out_path="$2"
  shift 2

  local start_ms end_ms exit_code
  start_ms=$(python3 -c "import time; print(int(time.time()*1000))")

  # Capture stdout (JSON) to file, stderr to console
  set +e
  "$@" > "$json_out_path" 2>&1
  exit_code=$?
  set -e

  end_ms=$(python3 -c "import time; print(int(time.time()*1000))")
  _STEP_EXIT=$exit_code
  _STEP_MS=$(( end_ms - start_ms ))

  # Print stderr-like progress
  echo "  $label: exit=$exit_code  ms=$_STEP_MS"

  return 0  # always succeed — we record exit_code in _STEP_EXIT
}

# ── Extract a field from JSON file ──
json_field() {
  local path="$1"
  local field="$2"
  python3 -c "import json; d=json.load(open('$path')); $field" 2>/dev/null || echo "N/A"
}

# ══════════════════════════════════════════════════════════════════════
#  Generic scenario runner
# ══════════════════════════════════════════════════════════════════════

run_scenario() {
  local scenario="$1"      # md | pdf | tex
  local source_path="$2"   # file or directory path
  local query_text="$3"    # question for query step
  local seed_text="$4"     # seed for inspire step

  echo "━━━ Scenario: $scenario ━━━"
  echo "  Source: $source_path"
  echo ""

  local WORKSPACE=$(mktemp -d /tmp/litewiki-e2e-${scenario}-XXXXXX)
  cd "$WORKSPACE"
  mkdir -p raw/chase wiki

  local INGEST_EXIT=0 INGEST_MS=0
  local AUDIT_EXIT=0  AUDIT_MS=0
  local QUERY_EXIT=0  QUERY_MS=0
  local INSPIRE_EXIT=0 INSPIRE_MS=0
  local INGEST_JSON="$WORKSPACE/ingest.json"
  local AUDIT_JSON="$WORKSPACE/audit.json"
  local QUERY_JSON="$WORKSPACE/query.json"
  local INSPIRE_JSON="$WORKSPACE/inspire.json"

  # Step 1: Ingest
  echo "  [1/4] Ingest..."
  run_cli_step "ingest" "$INGEST_JSON" $CLI ingest "$source_path" --auto --policy balanced --json
  INGEST_EXIT=$_STEP_EXIT; INGEST_MS=$_STEP_MS

  if [ $INGEST_EXIT -ne 0 ]; then
    echo "  ❌ Ingest failed, skipping remaining steps"
  else
    # Step 2: Audit (structure + semantic) — diagnostic, does NOT block later steps
    echo "  [2/4] Audit (structure + semantic)..."
    run_cli_step "audit" "$AUDIT_JSON" $CLI audit --semantic --json
    AUDIT_EXIT=$_STEP_EXIT; AUDIT_MS=$_STEP_MS

    # Step 3: Query
    echo "  [3/4] Query..."
    run_cli_step "query" "$QUERY_JSON" $CLI query "$query_text" --mode ask --json
    QUERY_EXIT=$_STEP_EXIT; QUERY_MS=$_STEP_MS

    # Step 4: Inspire
    echo "  [4/4] Inspire..."
    run_cli_step "inspire" "$INSPIRE_JSON" $CLI inspire --seed "$seed_text" --json
    INSPIRE_EXIT=$_STEP_EXIT; INSPIRE_MS=$_STEP_MS
  fi

  local TOTAL_MS=$(( INGEST_MS + AUDIT_MS + QUERY_MS + INSPIRE_MS ))

  # ── Extract metrics ──
  local INGEST_NODE_COUNT=$(json_field "$INGEST_JSON" "print(len(d.get('created',[])))")
  local INGEST_SOURCE_ID=$(json_field "$INGEST_JSON" "print(d.get('sourceId',''))")
  local AUDIT_AVG_SCORE=$(json_field "$AUDIT_JSON" "s=d.get('semantic',d.get('structure',{})); print(s.get('summary',{}).get('averageScore',0) if isinstance(s,dict) else 0)")
  local AUDIT_PASSED=$(json_field "$AUDIT_JSON" "s=d.get('semantic',d.get('structure',{})); print(s.get('summary',{}).get('passed',0) if isinstance(s,dict) else 0)")
  local AUDIT_FAILED=$(json_field "$AUDIT_JSON" "s=d.get('semantic',d.get('structure',{})); print(s.get('summary',{}).get('failed',0) if isinstance(s,dict) else 0)")
  local QUERY_SEED_COUNT=$(json_field "$QUERY_JSON" "print(d.get('boardSummary',{}).get('seedCount',0))")
  local INSPIRE_CONN_COUNT=$(json_field "$INSPIRE_JSON" "print(len(d.get('connections',[])))")
  local INSPIRE_HYP_COUNT=$(json_field "$INSPIRE_JSON" "print(len(d.get('hypotheses',[])))")

  # ── Write baseline ──
  local filepath="$BASELINE_DIR/${DATE_TAG}_${scenario}.json"
  cat > "$filepath" <<EOF
{
  "scenario": "$scenario",
  "timestamp": "$TIMESTAMP",
  "source": "$source_path",
  "steps": {
    "ingest":  { "exitCode": $INGEST_EXIT,  "ms": $INGEST_MS,  "nodeCount": $INGEST_NODE_COUNT, "sourceId": "$INGEST_SOURCE_ID" },
    "audit":   { "exitCode": $AUDIT_EXIT,   "ms": $AUDIT_MS,   "avgScore": $AUDIT_AVG_SCORE, "passed": $AUDIT_PASSED, "failed": $AUDIT_FAILED },
    "query":   { "exitCode": $QUERY_EXIT,   "ms": $QUERY_MS,   "seedCount": $QUERY_SEED_COUNT },
    "inspire": { "exitCode": $INSPIRE_EXIT, "ms": $INSPIRE_MS, "connections": $INSPIRE_CONN_COUNT, "hypotheses": $INSPIRE_HYP_COUNT }
  },
  "totalMs": $TOTAL_MS
}
EOF
  echo "  📊 Baseline written: $filepath"
  echo "  ✅ $scenario scenario complete (total: ${TOTAL_MS}ms)"
  echo ""
}

# ══════════════════════════════════════════════════════════════════════
#  Run all scenarios
# ══════════════════════════════════════════════════════════════════════

# Markdown
MD_SOURCE=$(find "$REPO_ROOT/raw/original/md" -name "*.md" -not -name ".*" | head -1)
if [ -n "$MD_SOURCE" ] && [ -f "$MD_SOURCE" ]; then
  run_scenario "md" "$MD_SOURCE" "What are the key ideas about AI agents?" "AI agents"
else
  echo "  ⏭️  MD scenario skipped (no .md file found)"
  echo ""
fi

# PDF
PDF_SOURCE=$(find "$REPO_ROOT/raw/original/pdf" -name "*.pdf" -not -name ".*" | head -1)
if [ -n "$PDF_SOURCE" ] && [ -f "$PDF_SOURCE" ]; then
  run_scenario "pdf" "$PDF_SOURCE" "What is the main contribution of this paper?" "neural network"
else
  echo "  ⏭️  PDF scenario skipped (no .pdf file found)"
  echo ""
fi

# TeX
TEX_DIR=$(find "$REPO_ROOT/raw/original/tex" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -n "$TEX_DIR" ] && [ -d "$TEX_DIR" ]; then
  run_scenario "tex" "$TEX_DIR" "What is knowledge distillation?" "distillation"
else
  echo "  ⏭️  TeX scenario skipped (no TeX project dir found)"
  echo ""
fi

# ══════════════════════════════════════════════════════════════════════
echo "═══════════════════════════════════════════════════════"
echo "  E2E Pipeline Verification Complete"
echo "  Baselines saved to: $BASELINE_DIR/"
echo "═══════════════════════════════════════════════════════"
echo ""
ls -la "$BASELINE_DIR/"*.json 2>/dev/null || echo "  (no baseline files found)"