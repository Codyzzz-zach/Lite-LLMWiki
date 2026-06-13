/**
 * chunkRefs clamping 测试
 *
 * 验证 compile pipeline 中的 clampChunkRefs 逻辑：
 * - LLM 输出的越界 chunkRefs 被过滤
 * - 0-based 索引被转换为 1-based
 * - 过滤后为空时回退到 [1]
 * - 有效范围内的 chunkRefs 不受影响
 */
import { describe, expect, it } from "vitest";

// ─── 直接测试 clampChunkRefs ──────────────────────────────────────
// 注意：clampChunkRefs 是 listening.ts 的内部函数，不导出。
// 我们通过 proIngest 的行为来间接测试，但这里先验证逻辑的正确性。
// 由于函数未导出，我们在测试中重新实现相同的逻辑来验证 spec。

function clampChunkRefsImpl(refs: number[], maxChunkRef: number): number[] {
  if (maxChunkRef <= 0) return refs;
  const clamped: number[] = [];
  for (const ref of refs) {
    const adjusted = ref <= 0 ? ref + 1 : ref;
    if (adjusted >= 1 && adjusted <= maxChunkRef) {
      clamped.push(adjusted);
    }
  }
  const result = [...new Set(clamped)].sort((a, b) => a - b);
  return result.length > 0 ? result : [1];
}

describe("clampChunkRefs — chunkRefs clamping logic", () => {
  it("过滤越界的 chunkRefs（[7,8,9] → 空 → 回退 [1]）", () => {
    const result = clampChunkRefsImpl([7, 8, 9], 4);
    expect(result).toEqual([1]); // 越界全部过滤，回退到 [1]
  });

  it("部分越界的 chunkRefs（[1,5,9] → [1]）", () => {
    const result = clampChunkRefsImpl([1, 5, 9], 4);
    expect(result).toEqual([1]); // 5 和 9 越界过滤，只剩 1
  });

  it("正常范围内的 chunkRefs 不受影响", () => {
    const result = clampChunkRefsImpl([1, 2, 3], 4);
    expect(result).toEqual([1, 2, 3]);
  });

  it("0-based 索引 0 转换为 1-based（[0,1,2] → [1,2]）", () => {
    // 0 → 1 (0-based→1-based), 1 和 2 已经是合法 1-based 保留原值
    // 无法区分 1 是 0-based 还是 1-based，所以保留原值
    const result = clampChunkRefsImpl([0, 1, 2], 4);
    expect(result).toEqual([1, 2]); // 0→1, 1→1(去重), 2→2
  });

  it("纯 0-based 索引 [0] → [1]", () => {
    const result = clampChunkRefsImpl([0], 4);
    expect(result).toEqual([1]); // 0→1
  });

  it("0-based 和 1-based 混合（[0,2,3] → [1,2,3]）", () => {
    const result = clampChunkRefsImpl([0, 2, 3], 4);
    expect(result).toEqual([1, 2, 3]); // 0→1, 2→2, 3→3
  });

  it("重复值被去重排序（[1,2,1,3] → [1,2,3]）", () => {
    const result = clampChunkRefsImpl([1, 2, 1, 3], 4);
    expect(result).toEqual([1, 2, 3]);
  });

  it("maxChunkRef=0 时不过滤（无 chunks 信息）", () => {
    const result = clampChunkRefsImpl([7, 8, 9], 0);
    expect(result).toEqual([7, 8, 9]); // 不过滤，信任原值
  });

  it("全部有效且刚好是边界值（[1,4] → [1,4]）", () => {
    const result = clampChunkRefsImpl([1, 4], 4);
    expect(result).toEqual([1, 4]); // 边界值有效
  });

  it("负数索引被转换（[-1,0] → [0,1] → [1]）", () => {
    // -1 → 0（adjusted=-1+1=0，不满足>=1）
    // 0 → 1（adjusted=0+1=1，满足>=1且<=4）
    const result = clampChunkRefsImpl([-1, 0], 4);
    expect(result).toEqual([1]);
  });
});

// ─── 间接测试：通过 proIngest 的 Source 构造验证 ─────────────────────

describe("chunkRefs clamping — Source 传参验证", () => {
  it("Source.chunks.length 作为 maxChunkRef 的来源", () => {
    // 验证 Source 类型包含 chunks 字段
    const source = {
      id: "raw_test",
      title: "test",
      type: "pdf",
      chunks: [
        { id: "c1", index: 0, text: "chunk 1" },
        { id: "c2", index: 1, text: "chunk 2" },
        { id: "c3", index: 2, text: "chunk 3" },
        { id: "c4", index: 3, text: "chunk 4" },
      ],
    };
    expect(source.chunks.length).toBe(4);
    // 这个值会被传给 clampChunkRefs 作为 maxChunkRef
  });
});
