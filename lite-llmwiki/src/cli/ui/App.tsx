import { Box } from "ink";
import React, { useState, useCallback, useRef } from "react";
import { loadConfig } from "../../config.js";
import { KnowledgeStore } from "../../knowledge/store.js";
import { loadFromFile } from "../../ingest/loader.js";
import { loadFromPdf } from "../../ingest/pdf-loader.js";
import { loadFromTex } from "../../ingest/tex-loader.js";
import { proIngest } from "../../ingest/listening.js";
import { queryKnowledge } from "../../query/engine.js";
import { DeepSeekClient } from "../../core/client.js";
import type { ConfirmedProposition, MainThread, Proposition, ProResult, Source, WikiNodeDraft, WikiPage } from "../../types.js";
import { StatusLine, type Stats } from "./StatusLine.js";
import { MessageLog, type ChatMessage } from "./MessageLog.js";
import { InputLine, type CommandFn } from "./InputLine.js";

type Phase =
  | "idle" | "loaded" | "brainstorming"
  | "waiting_thread"
  | "waiting_prop"
  | "waiting_angle"
  | "waiting_version"
  | "waiting_update"
  | "compiling" | "done";

export function App() {
  const config = loadConfig();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats>(() => ({ sources: 0, nodes: 0 }));
  const [phase, setPhase] = useState<Phase>("idle");

  const clientRef = useRef<DeepSeekClient | null>(null);
  const sourceRef = useRef<Source | null>(null);
  const threadsRef = useRef<MainThread[]>([]);
  const propsRef = useRef<Proposition[]>([]);
  const propIdxRef = useRef(0);
  const confirmedRef = useRef<ConfirmedProposition[]>([]);
  const currentPropRef = useRef<Proposition | null>(null);
  const mCountRef = useRef(0);
  const origReadingRef = useRef("");
  const origChunksRef = useRef<number[]>([]);
  const anchorRef = useRef("");

  const add = useCallback((m: ChatMessage) => setMsgs((p) => [...p, m]), []);
  const refresh = useCallback(async () => {
    try {
      const s = new KnowledgeStore(config).getStats();
      setStats({ sources: s.totalSources, nodes: s.totalNodes });
    } catch { /* */ }
  }, [config]);

  /** 统一保存：saveRaw + wikiNodes + devilsAdvocate + anchor + index + log */
  const doFinalSave = useCallback(async (
    store: KnowledgeStore, src: Source, cr: ProResult,
    nodeDrafts: WikiNodeDraft[], confirmedUpdates: WikiPage[],
    list: ConfirmedProposition[],
  ) => {
    add({ kind: "system", content: "Saving..." });
    store.saveRaw(src);
    for (const d of nodeDrafts) store.saveWikiNode(d);
    for (const p of confirmedUpdates) store.saveWikiPage(p);

    const ciList = list.filter((c) => c.counterIntuitive);
    if (ciList.length > 0) {
      const daId = `_da-${cr.materialId.slice(-8)}`;
      const daBody = ciList.map(
        (c) => `- ${c.claim}\n  → ${c.counterIntuitiveReason ?? "挑战了常见认知"}\n`
      ).join("\n");
      store.saveWikiPage({
        nodeId: daId, filePath: `wiki/concepts/${daId}.md`,
        frontmatter: { title: `反直觉视角: ${cr.title}`, source: cr.materialId, confidence: 0.4, createdAt: new Date().toISOString() },
        body: `AI 从以下已确认的知识点中识别出反直觉信号：\n\n${daBody}`,
      });
    }
    if (cr.humanAnchor) {
      store.saveWikiPage({
        nodeId: cr.humanAnchor.id, filePath: `wiki/concepts/${cr.humanAnchor.id}.md`,
        frontmatter: { title: cr.humanAnchor.text.slice(0, 80), source: cr.materialId, confidence: 1.0, createdAt: new Date().toISOString() },
        body: `## Anchor\n${cr.humanAnchor.text}\n\n材料: ${cr.materialId}`,
      });
    }
    const allProps = propsRef.current;
    store.rebuildIndex();
    store.appendLog({
      title: cr.title, source: cr.materialId,
      anchor: anchorRef.current || undefined,
      confirmed: list.length, total: allProps.length,
      newPages: nodeDrafts.length, updatedPages: confirmedUpdates.length,
    });
    add({ kind: "result", content: `✅ ${nodeDrafts.length} pages saved` });
    setPhase("done");
    await refresh();
  }, [add, refresh]);

  /** 开始编译 */
  const doCompile = useCallback(async () => {
    const src = sourceRef.current;
    const list = confirmedRef.current.filter((c) => c.status === "confirmed");
    if (!src || list.length === 0) { add({ kind: "warning", content: "无已确认条目" }); setPhase("idle"); return; }
    setPhase("compiling"); setBusy(true);
    try {
      const client = clientRef.current ?? new DeepSeekClient(config);
      const store = new KnowledgeStore(config);
      const existingPages = store.findRelatedPages(list);
      const cr = await proIngest({
        source: src, config, client, mode: "compile",
        confirmedPropositionsJson: JSON.stringify(list),
        existingPages: existingPages.length > 0 ? existingPages : undefined,
      });
      const nodeDrafts = cr.nodeDrafts ?? [];
      const updatedPages = cr.updatedPages ?? [];
      add({ kind: "result", content: `pages: ${nodeDrafts.length} new, ${updatedPages.length} updated` });

      if (updatedPages.length > 0) {
        // 暂存用于逐条确认
        (clientRef as any)._cr = cr;
        (clientRef as any)._store = store;
        (clientRef as any)._nodeDrafts = nodeDrafts;

        add({ kind: "system", content: `📄 更新 1/${updatedPages.length}:\n${updatedPages[0]!.body.slice(0, 300)}` });
        add({ kind: "system", content: "  [a] 应用更新  [s] 跳过" });
        (clientRef as any)._pendingUpdates = updatedPages;
        (clientRef as any)._updateIdx = 0;
        (clientRef as any)._confirmedUpdates = [];
        setPhase("waiting_update");
        return; // 等待用户输入
      }

      // 无更新，直接保存
      await doFinalSave(store, src, cr, nodeDrafts, [], list);
    } catch (e) { add({ kind: "error", content: `编译: ${(e as Error).message}` }); }
    setBusy(false);
  }, [config, add, doFinalSave]);

  /** 展示当前 proposition */
  const showProp = useCallback(() => {
    const prop = currentPropRef.current;
    if (!prop) return;
    const all = propsRef.current.length;
    const rev = prop.revision > 0 ? ` (r${prop.revision})` : "";
    add({ kind: "system", content: `📄  [${prop.id}/${all}]${rev}  ${prop.claim}` });
    add({ kind: "ai", content: `🤖  ${prop.aiReading}  (Chunk ${prop.chunkRefs.join(", ")})` });
    if (prop.counterIntuitive && prop.counterIntuitiveReason) {
      add({ kind: "system", content: `⚡ 反直觉: ${prop.counterIntuitiveReason}` });
    }
    add({ kind: "system", content: "  [a]对齐  [s]跳过  [m]不同角度" });
  }, [add]);

  /** 前进到下一个 proposition */
  const nextProp = useCallback(() => {
    propIdxRef.current++;
    const props = propsRef.current;
    if (propIdxRef.current >= props.length) {
      add({ kind: "system", content: "✅ 全部确认完毕，编译中..." });
      doCompile();
    } else {
      currentPropRef.current = { ...props[propIdxRef.current]! };
      mCountRef.current = 0;
      setPhase("waiting_prop");
      showProp();
    }
  }, [add, doCompile, showProp]);

  /** 处理 m 模式 rerrun：调用 reread API */
  const doReread = useCallback(async (angle: string) => {
    const src = sourceRef.current;
    const prop = currentPropRef.current;
    if (!src || !prop) return;
    setBusy(true);
    try {
      const client = clientRef.current ?? new DeepSeekClient(config);
      const rr = await proIngest({
        source: src, config, client, mode: "reread",
        claim: prop.claim, humanAngle: angle, targetChunkRefs: prop.chunkRefs,
      });
      const revised = rr.propositions?.[0];
      if (revised) {
        const rev = prop.revision + 1;
        origReadingRef.current = prop.aiReading;
        origChunksRef.current = prop.chunkRefs;
        currentPropRef.current = { ...revised, id: prop.id, threadId: prop.threadId, revision: rev,
          counterIntuitive: prop.counterIntuitive, counterIntuitiveReason: prop.counterIntuitiveReason,
        };
        add({ kind: "result", content: `🔄 修订版 (r${rev}/3)` });
        add({ kind: "system", content: `🤖 [原版] ${origReadingRef.current}` });
        add({ kind: "system", content: `   [a]对齐原版  [r]对齐修订版  [m]再换角度  [s]跳过` });
      } else {
        add({ kind: "warning", content: "重读失败" });
        setPhase("waiting_prop");
      }
    } catch (e) { add({ kind: "error", content: `reread: ${(e as Error).message}` }); setPhase("waiting_prop"); }
    setBusy(false);
    setPhase("waiting_version"); // Opt4: 让用户选原版/修订版
  }, [config, add]);

  // ── 命令处理 ──

  const handleCommand: CommandFn = useCallback(async (cmd: string, args: string) => {
    // 非命令输入 → 按当前 phase 处理
    if (!cmd) {
      const raw = args;

      if (phase === "waiting_thread") {
        const n = Number(raw);
        const threads = threadsRef.current;
        const allProps = propsRef.current;

        let target: Proposition[];
        if (!raw.trim() || !threads.some((t) => t.id === n)) {
          target = allProps;
          add({ kind: "result", content: "📋 全部主线" });
        } else {
          target = allProps.filter((p) => p.threadId === n);
          add({ kind: "result", content: `📋 主线 [${n}]` });
        }

        if (target.length === 0) {
          add({ kind: "warning", content: "该主线下无内容" });
          setPhase("idle");
          return;
        }

        propsRef.current = target;
        propIdxRef.current = 0;
        currentPropRef.current = { ...target[0]! };
        mCountRef.current = 0;
        setPhase("waiting_prop");
        add({ kind: "system", content: `\n  [3] 逐条确认 — ${target.length} 条` });
        showProp();
        return;
      }

      if (phase === "waiting_prop") {
        const ch = raw.trim().toLowerCase();
        const prop = currentPropRef.current;
        if (!prop) return;

        // Opt3: a all 批量确认剩余全部
        if (ch === "a all") {
          // 当前条
          confirmedRef.current.push({
            propId: prop.id, threadId: prop.threadId, claim: prop.claim,
            aiReading: prop.aiReading, chunkRefs: prop.chunkRefs,
            revision: prop.revision, status: "confirmed",
            counterIntuitive: prop.counterIntuitive,
            counterIntuitiveReason: prop.counterIntuitiveReason,
          });
          add({ kind: "result", content: `✅ [${prop.id}] 已确认` });
          // 剩余全部
          const all = propsRef.current;
          const curIdx = propIdxRef.current;
          for (let i = curIdx + 1; i < all.length; i++) {
            const rest = all[i]!;
            confirmedRef.current.push({
              propId: rest.id, threadId: rest.threadId, claim: rest.claim,
              aiReading: rest.aiReading, chunkRefs: rest.chunkRefs,
              revision: 0, status: "confirmed",
              counterIntuitive: rest.counterIntuitive,
              counterIntuitiveReason: rest.counterIntuitiveReason,
            });
            add({ kind: "result", content: `✅ [${rest.id}] 批量确认` });
          }
          propIdxRef.current = all.length; // 结束循环
          add({ kind: "system", content: "✅ 全部确认完毕，编译中..." });
          doCompile();
          return;
        }

        if (ch === "a") {
          confirmedRef.current.push({
            propId: prop.id, threadId: prop.threadId, claim: prop.claim,
            aiReading: prop.aiReading, chunkRefs: prop.chunkRefs,
            revision: prop.revision, status: "confirmed",
            counterIntuitive: prop.counterIntuitive,
            counterIntuitiveReason: prop.counterIntuitiveReason,
          });
          add({ kind: "result", content: `✅ [${prop.id}] 已确认` });
          nextProp();
        } else if (ch === "s") {
          add({ kind: "result", content: `⏭️  [${prop.id}] 已跳过` });
          nextProp();
        } else if (ch === "m") {
          if (mCountRef.current >= 3) {
            add({ kind: "warning", content: "m 上限 3 次" });
            return;
          }
          setPhase("waiting_angle");
          add({ kind: "system", content: "  输入你的角度:" });
        } else {
          add({ kind: "error", content: "a / a all / s / m" });
        }
        return;
      }

      if (phase === "waiting_angle") {
        const angle = raw.trim();
        if (!angle) { add({ kind: "error", content: "角度不能为空" }); return; }
        mCountRef.current++;
        add({ kind: "system", content: `[Pro] 基于「${angle.slice(0, 40)}…」重读...` });
        await doReread(angle);
        return;
      }

      if (phase === "waiting_version") {
        const ch = raw.trim().toLowerCase();
        const prop = currentPropRef.current;
        if (!prop) return;

        if (ch === "a") {
          // 用原版
          confirmedRef.current.push({
            propId: prop.id, threadId: prop.threadId, claim: prop.claim,
            aiReading: origReadingRef.current, chunkRefs: origChunksRef.current,
            revision: 0, status: "confirmed",
            counterIntuitive: prop.counterIntuitive,
            counterIntuitiveReason: prop.counterIntuitiveReason,
          });
          add({ kind: "result", content: `✅ [${prop.id}] 已确认（原版）` });
          nextProp();
        } else if (ch === "r") {
          // 用修订版
          confirmedRef.current.push({
            propId: prop.id, threadId: prop.threadId, claim: prop.claim,
            aiReading: prop.aiReading, chunkRefs: prop.chunkRefs,
            revision: prop.revision, status: "confirmed",
            counterIntuitive: prop.counterIntuitive,
            counterIntuitiveReason: prop.counterIntuitiveReason,
          });
          add({ kind: "result", content: `✅ [${prop.id}] 已确认（修订版 r${prop.revision}）` });
          nextProp();
        } else if (ch === "m") {
          if (mCountRef.current >= 3) {
            add({ kind: "warning", content: "m 上限 3 次" });
            return;
          }
          setPhase("waiting_angle");
          add({ kind: "system", content: "  再输入一个角度:" });
        } else if (ch === "s") {
          add({ kind: "result", content: `⏭️  [${prop.id}] 已跳过` });
          nextProp();
        } else {
          add({ kind: "error", content: "a / r / m / s" });
        }
        return;
      }

      // waiting_update: 逐条确认 updatedPages
      if (phase === "waiting_update") {
        const ch = raw.trim().toLowerCase();
        const updates = (clientRef as any)._pendingUpdates as any[] | undefined;
        if (!updates || updates.length === 0) { return; }

        const idx = (clientRef as any)._updateIdx ?? 0;
        const confirmedUpdates: any[] = (clientRef as any)._confirmedUpdates ?? [];

        if (ch === "a") {
          confirmedUpdates.push(updates[idx]!);
          add({ kind: "result", content: `✅ 更新已确认` });
        } else if (ch === "s") {
          add({ kind: "result", content: `⏭️  已跳过` });
        } else {
          add({ kind: "error", content: "a 或 s" });
          return;
        }

        const next = idx + 1;
        if (next < updates.length) {
          (clientRef as any)._updateIdx = next;
          (clientRef as any)._confirmedUpdates = confirmedUpdates;
          add({ kind: "system", content: `📄 更新 ${next + 1}/${updates.length}:\n${updates[next]!.body.slice(0, 300)}` });
          add({ kind: "system", content: "  [a] 应用更新  [s] 跳过" });
        } else {
          // 全部确认完毕，保存
          const store = (clientRef as any)._store;
          const src = sourceRef.current;
          const cr = (clientRef as any)._cr;
          const nodeDrafts = (clientRef as any)._nodeDrafts ?? [];
          const list = confirmedRef.current.filter((c) => c.status === "confirmed");

          if (store && src && cr) {
            await doFinalSave(store, src, cr, nodeDrafts, confirmedUpdates, list);
          }
        }
        return;
      }

      return;
    }

    // 命令
    setBusy(true);
    add({ kind: "user", content: `:${cmd} ${args}` });

    switch (cmd) {
      case "ingest": {
        if (!args) { add({ kind: "error", content: "需要文件路径" }); break; }
        try {
          if (args.toLowerCase().endsWith(".pdf")) {
            add({ kind: "system", content: "📥 MinerU 解析 PDF..." });
            const src: Source = await loadFromPdf(args, { config });
            add({ kind: "result", content: `${src.title}  |  ${src.chunks.length} chunks  |  ~${src.totalTokens} tokens` });
            add({ kind: "system", content: '💡 :anchor "问题" 开始 Brainstorm' });
            sourceRef.current = src;
            setPhase("loaded");
          } else {
            add({ kind: "system", content: "📥 加载材料..." });
            const src: Source = args.toLowerCase().endsWith(".tex")
              ? await loadFromTex(args, config) : loadFromFile(args, config);
            add({ kind: "result", content: `${src.title}  |  ${src.chunks.length} chunks  |  ~${src.totalTokens} tokens` });
            add({ kind: "system", content: '💡 :anchor "问题" 开始 Brainstorm' });
            sourceRef.current = src;
            setPhase("loaded");
          }
        } catch (e) { add({ kind: "error", content: `${(e as Error).message}` }); }
        break;
      }

      case "anchor": {
        const src = sourceRef.current;
        if (!src) { add({ kind: "error", content: "先 :ingest <file>" }); break; }
        const anchor = args || "概括";
        anchorRef.current = anchor;
        setPhase("brainstorming");
        try {
          const client = new DeepSeekClient(config);
          clientRef.current = client;
          add({ kind: "system", content: `🎯 "${anchor}"` });
          add({ kind: "system", content: "📝 Brainstorm..." });

          const br = await proIngest({ source: src, anchor, config, client, mode: "extract" });
          const threads = br.mainThreads ?? [];
          const allProps = br.propositions ?? [];

          if (threads.length === 0) { add({ kind: "warning", content: "无内容" }); setPhase("idle"); break; }

          threadsRef.current = threads;
          propsRef.current = allProps;
          confirmedRef.current = [];

          add({ kind: "result", content: `📋 ${threads.length} 条主线:` });
          for (const t of threads) {
            add({ kind: "ai", content: ` [${t.id}] ${t.title}\n     ${t.description}` });
          }

          // Opt1: <5 chunks 自动选全部
          if (src.chunks.length < 5) {
            add({ kind: "system", content: "📋 短文档，自动全部" });
            propsRef.current = allProps;
            propIdxRef.current = 0;
            currentPropRef.current = { ...allProps[0]! };
            mCountRef.current = 0;
            setPhase("waiting_prop");
            add({ kind: "system", content: `\n  [3] 逐条确认 — ${allProps.length} 条` });
            showProp();
          } else {
            add({ kind: "system", content: "❯ 选主线编号（回车=全部）" });
            setPhase("waiting_thread");
          }
        } catch (e) { add({ kind: "error", content: `${(e as Error).message}` }); setPhase("idle"); }
        break;
      }

      case "query": {
        if (!args) { add({ kind: "error", content: "需要问题" }); break; }
        try {
          add({ kind: "system", content: "🔍 ..." });
          const r = await queryKnowledge({ question: args, config });
          add({ kind: "ai", content: r.answer, sources: r.sources.map((p) => p.filePath) });
        } catch (e) { add({ kind: "error", content: `${(e as Error).message}` }); }
        break;
      }

      case "node": {
        if (!args) { add({ kind: "error", content: "需要 ID" }); break; }
        try {
          const store = new KnowledgeStore(config);
          const m = store.listWikiPages().filter((p) => p.includes(args));
          if (!m.length) add({ kind: "error", content: "未找到" });
          else add({ kind: "system", content: `${m[0]!}\n\n${store.readWikiPage(m[0]!)?.slice(0, 1500) ?? ""}` });
        } catch (e) { add({ kind: "error", content: `${(e as Error).message}` }); }
        break;
      }

      case "status": {
        await refresh();
        add({ kind: "result", content: `sources: ${stats.sources}  |  wiki: ${stats.nodes}` });
        break;
      }

      case "clear":
        setMsgs([]); sourceRef.current = null; setPhase("idle");
        break;

      case "help":
        add({ kind: "ai", content: [
          ':ingest <file>   加载', ':anchor "text"   Brainstorm→主线→确认→wiki',
          ':query "text"    查询', ':node <id>       查看', ':status          统计', ':clear           清屏',
        ].join("\n") });
        break;

      default:
        add({ kind: "error", content: `未知 :${cmd}` });
    }
    setBusy(false);
  }, [config, stats, add, refresh, phase, showProp, nextProp, doReread]);

  return (
    <Box flexDirection="column" height="100%">
      <StatusLine stats={stats} />
      <MessageLog messages={msgs} />
      <InputLine
        onCommand={handleCommand}
        onRawInput={phase !== "idle" && phase !== "loaded" && phase !== "done"
          ? ((text: string) => handleCommand("", text, text)) : undefined}
        busy={busy}
        phase={phase as any}
      />
    </Box>
  );
}
