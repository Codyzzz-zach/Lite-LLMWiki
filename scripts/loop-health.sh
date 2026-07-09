#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# loop-health.sh — LiteWikiagent 的第一条 Loop (Level 1: 只读 triage)
#
# 教程对应：loop_engineering_tutorial.html §08 "如何设计你的第一个 loop"
#
# 五个动作：
#   Discovery    → git diff 检测未提交修改
#   Handoff      → 无（不需要 agent 执行，只需要 CLI 命令）
#   Verification → npm run typecheck + npm run test
#   Persistence  → 追加结果到 loopadvance/progress.md
#   Scheduling   → 全绿=停止；失败=记录原因+建议，升级给人
#
# 验证条件（教程 §06 Rule 1-3）：
#   - typecheck 退出 0
#   - test 全绿
#   - 有天花板：最多跑一次（不做无限重试）
#
# 用法：
#   bash scripts/loop-health.sh          # 运行并追加日志
#   bash scripts/loop-health.sh --quiet  # 只输出 JSON 到 stdout
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── 路径定位 ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WIKI_DIR="$PROJECT_ROOT/lite-llmwiki"
LOOP_DIR="$PROJECT_ROOT/loopadvance"
PROGRESS_FILE="$LOOP_DIR/progress.md"
STATUS_FILE="$LOOP_DIR/STATUS.md"

# 确保 loopadvance 目录存在
mkdir -p "$LOOP_DIR"

# ─── 时间戳 ──────────────────────────────────────────────────────
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

# ─── 计数器（从 progress.md 读取上次 run 编号）──────────────────
RUN_NUM=$(grep -c "^## \[" "$PROGRESS_FILE" 2>/dev/null || echo "0")
RUN_NUM=$((RUN_NUM + 1))

# ─── 1. Discovery: git 状态 ──────────────────────────────────────
cd "$PROJECT_ROOT"
GIT_MODIFIED=$(git status --porcelain | wc -l | tr -d ' ')
GIT_STATUS="clean"
if [ "$GIT_MODIFIED" -gt 0 ]; then
  GIT_STATUS="$GIT_MODIFIED files modified"
fi

# ─── 2. Verification: typecheck ─────────────────────────────────
TYPECHECK_PASS=false
TYPECHECK_ERRORS=0
TYPECHECK_OUTPUT=""

cd "$WIKI_DIR"
TYPECHECK_RAW=$(npm run typecheck 2>&1 || true)

if echo "$TYPECHECK_RAW" | grep -q "error TS"; then
  TYPECHECK_ERRORS=$(echo "$TYPECHECK_RAW" | grep -c "error TS" || true)
  TYPECHECK_OUTPUT=$(echo "$TYPECHECK_RAW" | grep "error TS" | head -10)
else
  TYPECHECK_PASS=true
fi

# ─── 3. Verification: test ──────────────────────────────────────
TEST_PASS=false
TEST_TOTAL=0
TEST_FAILED=0
TEST_PASSED=0
TEST_OUTPUT=""
FAILING_TESTS=""

# vitest run 输出格式: "Tests  26 failed | 212 passed (238)"
TEST_RAW=$(npm run test 2>&1 || true)

# 提取测试统计
TEST_LINE=$(echo "$TEST_RAW" | grep "Tests " | tail -1 || true)
if [ -n "$TEST_LINE" ]; then
  TEST_FAILED=$(echo "$TEST_LINE" | grep -o '[0-9]* failed' | grep -o '[0-9]*' || echo "0")
  TEST_PASSED=$(echo "$TEST_LINE" | grep -o '[0-9]* passed' | grep -o '[0-9]*' || echo "0")
  TEST_TOTAL=$(echo "$TEST_LINE" | grep -o '([0-9]*)' | tr -d '()' || echo "0")
  TEST_TOTAL=${TEST_TOTAL:-0}
  if [ "$TEST_FAILED" = "0" ] && [ "$TEST_PASSED" -gt 0 ]; then
    TEST_PASS=true
  fi
fi

# 提取失败的测试文件名
if [ "$TEST_FAILED" -gt 0 ] 2>/dev/null; then
  FAILING_TESTS=$(echo "$TEST_RAW" | grep "FAIL " | sed 's/FAIL //' | head -10 || true)
fi

# ─── 4. 判定 ────────────────────────────────────────────────────
OVERALL_PASS=false
NEXT_ACTION=""

if $TYPECHECK_PASS && $TEST_PASS; then
  OVERALL_PASS=true
  NEXT_ACTION="all green — safe to build on top"
elif $TYPECHECK_PASS && ! $TEST_PASS; then
  NEXT_ACTION="typecheck ok but $TEST_FAILED tests failing — fix tests before adding features"
elif ! $TYPECHECK_PASS && $TEST_PASS; then
  NEXT_ACTION="$TYPECHECK_ERRORS typecheck errors — fix types first"
else
  NEXT_ACTION="$TYPECHECK_ERRORS typecheck errors + $TEST_FAILED test failures — fix both"
fi

# ─── 5. Wiki + Graph + Backlog 健康度（通过 health.ts 采集）─────
WIKI_HEALTH_JSON=""
WIKI_TOTAL=0
WIKI_AUDIT="N/A"
WIKI_AVG_SCORE="N/A"
GRAPH_ORPHAN_RATE="N/A"
GRAPH_CONTRADICTS="N/A"
BACKLOG_COUNT=0
BACKLOG_LEVEL="normal"
DAEMON_RUNNING="N/A"
VERDICT="unknown"

cd "$WIKI_DIR"
WIKI_HEALTH_JSON=$(npx tsx src/daemon/health.ts --json 2>/dev/null || echo "{}")

if [ -n "$WIKI_HEALTH_JSON" ] && [ "$WIKI_HEALTH_JSON" != "{}" ]; then
  WIKI_TOTAL=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('wiki',{}).get('totalNodes',0))" 2>/dev/null || echo "0")
  WIKI_PASSED=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('wiki',{}).get('auditBreakdown',{}).get('passed',0))" 2>/dev/null || echo "0")
  WIKI_WARNING=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('wiki',{}).get('auditBreakdown',{}).get('warning',0))" 2>/dev/null || echo "0")
  WIKI_FAILED=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('wiki',{}).get('auditBreakdown',{}).get('failed',0))" 2>/dev/null || echo "0")
  WIKI_PENDING=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('wiki',{}).get('auditBreakdown',{}).get('pending',0))" 2>/dev/null || echo "0")
  WIKI_AUDIT="${WIKI_PASSED}p/${WIKI_WARNING}w/${WIKI_FAILED}f/${WIKI_PENDING}pd"
  WIKI_AVG_SCORE=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('wiki',{}).get('averageScore',0))" 2>/dev/null || echo "0")
  GRAPH_ORPHAN_RATE=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('graph',{}).get('orphanRate',0))" 2>/dev/null || echo "0")
  GRAPH_CONTRADICTS=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('graph',{}).get('contradictionCount',0))" 2>/dev/null || echo "0")
  BACKLOG_COUNT=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('backlog',{}).get('count',0))" 2>/dev/null || echo "0")
  BACKLOG_LEVEL=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('backlog',{}).get('level','normal'))" 2>/dev/null || echo "normal")
  DAEMON_RUNNING=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d.get('daemon',{}).get('running') else 'no')" 2>/dev/null || echo "N/A")
  VERDICT=$(echo "$WIKI_HEALTH_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('verdict','unknown'))" 2>/dev/null || echo "unknown")
fi
# 根据 wiki verdict 合并 overall
if [ "$VERDICT" = "red" ]; then
  OVERALL_PASS=false
  NEXT_ACTION="$NEXT_ACTION | wiki: RED — audit/graph issues need attention"
elif [ "$VERDICT" = "yellow" ]; then
  NEXT_ACTION="$NEXT_ACTION | wiki: YELLOW — monitor audit/graph closely"
fi

# ─── 6. Persistence: 写 progress.md ─────────────────────────────
{
  echo ""
  echo "## [$TIMESTAMP] run #$RUN_NUM"
  echo "- typecheck: $(if $TYPECHECK_PASS; then echo "PASS"; else echo "FAIL ($TYPECHECK_ERRORS errors)"; fi)"
  echo "- test: $(if $TEST_PASS; then echo "PASS ($TEST_PASSED pass / $TEST_TOTAL total)"; else echo "FAIL ($TEST_FAILED fail / $TEST_PASSED pass / $TEST_TOTAL total)"; fi)"
  echo "- git: $GIT_STATUS"
  if [ "$TYPECHECK_ERRORS" -gt 0 ] 2>/dev/null; then
    echo "- typecheck_errors:"
    echo "$TYPECHECK_OUTPUT" | sed 's/^/  /'
  fi
  if [ -n "$FAILING_TESTS" ]; then
    echo "- failing_tests:"
    echo "$FAILING_TESTS" | sed 's/^/  /'
  fi
  echo "- next_action: $NEXT_ACTION"
} >> "$PROGRESS_FILE"

# ─── 6. Persistence: 更新 STATUS.md（系统状态快照）──────────────
{
  echo "# Loop Status — 系统状态快照"
  echo ""
  echo "> 本文件由 \`scripts/loop-health.sh\` 自动更新。"
  echo "> 人类和 agent 读此文件了解当前系统状态。"
  echo ""
  echo "## 当前健康度"
  echo ""
  echo "| 指标 | 状态 |"
  echo "|------|------|"
  echo "| typecheck | $(if $TYPECHECK_PASS; then echo "✅ PASS"; else echo "❌ FAIL ($TYPECHECK_ERRORS errors)"; fi) |"
  echo "| test | $(if $TEST_PASS; then echo "✅ PASS ($TEST_PASSED/$TEST_TOTAL)"; else echo "❌ FAIL ($TEST_FAILED fail)"; fi) |"
  echo "| git | $(if [ "$GIT_MODIFIED" -gt 0 ]; then echo "⚠ $GIT_STATUS"; else echo "✅ clean"; fi) |"
  echo "| wiki nodes | $WIKI_TOTAL |"
  echo "| wiki audit | $WIKI_AUDIT (avg: $WIKI_AVG_SCORE) |"
  echo "| graph orphans | ${GRAPH_ORPHAN_RATE}% (contradicts: $GRAPH_CONTRADICTS) |"
  echo "| backlog | $BACKLOG_COUNT ($BACKLOG_LEVEL) |"
  echo "| daemon | $DAEMON_RUNNING |"
  echo "| verdict | $(if [ "$VERDICT" = "green" ]; then echo "✅ GREEN"; elif [ "$VERDICT" = "yellow" ]; then echo "⚠️ YELLOW"; else echo "❌ RED"; fi) |"
  echo ""
  echo "## 上次运行"
  echo ""
  echo "- 时间: $TIMESTAMP"
  echo "- 编号: run #$RUN_NUM"
  echo "- 判定: $(if $OVERALL_PASS; then echo "✅ ALL GREEN"; else echo "❌ ISSUES FOUND"; fi)"
  echo "- 建议: $NEXT_ACTION"
  echo ""
  if [ -n "$FAILING_TESTS" ]; then
    echo "## 待处理：失败的测试文件"
    echo ""
    echo '```'
    echo "$FAILING_TESTS"
    echo '```'
    echo ""
  fi
  if [ "$TYPECHECK_ERRORS" -gt 0 ] 2>/dev/null; then
    echo "## 待处理：typecheck 错误"
    echo ""
    echo '```'
    echo "$TYPECHECK_OUTPUT"
    echo '```'
    echo ""
  fi
  echo "## 完整历史"
  echo ""
  echo "见 [progress.md](./progress.md)"
} > "$STATUS_FILE"

# ─── 7. 输出到 stdout ───────────────────────────────────────────
if [ "${1:-}" = "--quiet" ]; then
  # JSON 模式（给 agent 读）
  cat <<EOF
{"run":$RUN_NUM,"timestamp":"$TIMESTAMP","typecheck":{"pass":$TYPECHECK_PASS,"errors":$TYPECHECK_ERRORS},"test":{"pass":$TEST_PASS,"failed":$TEST_FAILED,"passed":$TEST_PASSED,"total":$TEST_TOTAL},"git":{"modified":$GIT_MODIFIED},"overall":{"pass":$OVERALL_PASS},"next_action":"$NEXT_ACTION"}
EOF
else
  # 人类可读模式
  echo ""
  echo "  ───────────────────────────────────────────"
  echo "  Loop Health — run #$RUN_NUM"
  echo "  $TIMESTAMP"
  echo "  ───────────────────────────────────────────"
  echo ""
  echo "  typecheck:  $(if $TYPECHECK_PASS; then echo "✅ PASS"; else echo "❌ FAIL ($TYPECHECK_ERRORS errors)"; fi)"
  echo "  test:       $(if $TEST_PASS; then echo "✅ PASS ($TEST_PASSED/$TEST_TOTAL)"; else echo "❌ FAIL ($TEST_FAILED fail / $TEST_PASSED pass / $TEST_TOTAL total)"; fi)"
  echo "  git:        $(if [ "$GIT_MODIFIED" -gt 0 ]; then echo "⚠ $GIT_STATUS"; else echo "✅ clean"; fi)"
  echo ""
  if $OVERALL_PASS; then
    echo "  ✅ ALL GREEN — $NEXT_ACTION"
  else
    echo "  ❌ ISSUES FOUND"
    echo "  → $NEXT_ACTION"
    if [ -n "$FAILING_TESTS" ]; then
      echo ""
      echo "  Failing tests:"
      echo "$FAILING_TESTS" | sed 's/^/    /'
    fi
  fi
  echo ""
  echo "  Written to:"
  echo "    $PROGRESS_FILE"
  echo "    $STATUS_FILE"
  echo ""
fi
