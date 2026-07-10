/**
 * selectPropsContext — prop 邻近窗口审计上下文测试
 *
 * 设计决策 #2 / §02 改造点③：审计上下文用 prop 邻近窗口(±3)替代 chunk 选择。
 */
import { describe, it, expect } from "vitest";
import { selectPropsContextFromContent } from "../src/knowledge/chase.js";

const CHASE = `---
sourceId: test
fingerprint: abc
---

正文开头。

<!-- prop 1 -->
第一个命题内容。
<!-- /prop 1 -->

<!-- prop 2 -->
第二个命题。
<!-- /prop 2 -->

<!-- prop 3 -->
第三个命题。
<!-- /prop 3 -->

<!-- prop 4 -->
第四个命题。
<!-- /prop 4 -->

<!-- prop 5 -->
第五个命题。
<!-- /prop 5 -->

<!-- prop 6 -->
第六个命题。
<!-- /prop 6 -->

<!-- prop 7 -->
第七个命题。
<!-- /prop 7 -->`;

describe("selectPropsContextFromContent", () => {
  it("取 propRef 及其 ±3 邻近窗口", () => {
    // 引用 prop 4，窗口 ±3 → prop 1..7（全部，因为 4±3=1..7）
    const ctx = selectPropsContextFromContent(CHASE, [4], 3);
    expect(ctx).toContain("第一个命题");
    expect(ctx).toContain("第四个命题");
    expect(ctx).toContain("第七个命题");
  });

  it("边界：引用 prop 1，窗口不越界下限", () => {
    // prop 1，±3 → 1..4
    const ctx = selectPropsContextFromContent(CHASE, [1], 3);
    expect(ctx).toContain("第一个命题");
    expect(ctx).toContain("第四个命题");
    expect(ctx).not.toContain("第五个命题");
  });

  it("边界：引用 prop 7，窗口不越界上限", () => {
    // prop 7，±3 → 4..7
    const ctx = selectPropsContextFromContent(CHASE, [7], 3);
    expect(ctx).toContain("第四个命题");
    expect(ctx).toContain("第七个命题");
    expect(ctx).not.toContain("第三个命题");
  });

  it("多个 propRef 去重合并", () => {
    // 引用 prop 1 和 prop 7，窗口 ±1 → {1,2} ∪ {6,7}
    const ctx = selectPropsContextFromContent(CHASE, [1, 7], 1);
    expect(ctx).toContain("第一个命题");
    expect(ctx).toContain("第二个命题");
    expect(ctx).toContain("第六个命题");
    expect(ctx).toContain("第七个命题");
    // 不含中间的
    expect(ctx).not.toContain("第三个命题");
    expect(ctx).not.toContain("第四个命题");
    expect(ctx).not.toContain("第五个命题");
  });

  it("无 prop marker 时回退整文", () => {
    const ctx = selectPropsContextFromContent("没有 marker 的纯文本", [1], 3);
    expect(ctx).toBe("没有 marker 的纯文本");
  });

  it("propRef 不存在时返回空", () => {
    const ctx = selectPropsContextFromContent(CHASE, [999], 3);
    expect(ctx).toBe("");
  });

  it("propRef 为字符串数字也支持", () => {
    const ctx = selectPropsContextFromContent(CHASE, ["4"], 3);
    expect(ctx).toContain("第四个命题");
  });
});
