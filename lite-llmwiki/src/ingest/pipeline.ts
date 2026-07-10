/**
 * pipeline — 共享管线函数
 *
 * CLI 和 daemon 都通过此模块执行 ingest 流程。
 * 设计定位（§14）：daemon 是加速器，CLI 是完整后备——两者走同一条路径。
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeepSeekClient } from "../core/client.js";
import { writeAuditGate } from "../knowledge/audit-gate.js";
import { auditWiki, writeAuditResults } from "../knowledge/audit.js";
import { readChaseProps } from "../knowledge/chase.js";
import { renderWikiNode } from "../knowledge/render.js";
import {
	runSemanticAudit,
	writeSemanticAuditResults,
} from "../knowledge/semantic-audit.js";
import { parseWikiFile, scanWikiFiles } from "../knowledge/wiki-parser.js";
import { writeConfirmSection } from "../evolution/confirm.js";
import type { ConfirmItem } from "../evolution/confirm.js";
import type { AppConfig, Evidence, WikiKind, WikiNodeDraft } from "../types.js";
import { extractPropositions } from "./proposition.js";

interface PipelineResult {
	propsExtracted: number;
	nodesCompiled: number;
	edgesWritten: number;
	audit: { structure: boolean; semantic: boolean; score: number } | null;
	contradictionsFound: number;
	reinforcementsFound: number;
}

/**
 * compile prompt 的输入字符预算（截断阈值）。
 *
 * Finding 10：deepseek-v4-flash 的 context window = 256K token。
 * 256K token ≈ 100K-170K 字符（中文约 1.5-2.5 token/字），
 * 256000 字符阈值在 context window 内安全。
 *
 * 语义：
 * - 正常材料（单篇论文，几千-几万字符）：根本不到阈值，不截断，全文送 LLM。
 * - 超大材料（整本书，几十万字符）：截到 256000 字符保底，前面的命题能进 wiki，
 *   避免超 context window 导致 API 报错 compile 整个失败。
 *
 * 设计决策 #3 / §02 改造点④ 的「自适应」体现在：阈值基于模型 context window
 * （而非硬编码 12000），且远大于正常材料——等于「正常不截断，超大才保底」。
 *
 * @param maxTokens  保留参数（向后兼容签名，当前不参与计算——阈值固定）
 */
export function compileInputBudget(_maxTokens?: number): number {
	return 256000;
}

/**
 * 完整 ingest 管线：提取命题 → 编译 wiki → 审计 → 矛盾+强化检测
 */
export async function runIngestPipeline(
	config: AppConfig,
	chaseFile: string,
	client: DeepSeekClient,
): Promise<PipelineResult> {
	const result: PipelineResult = {
		propsExtracted: 0,
		nodesCompiled: 0,
		edgesWritten: 0,
		audit: null,
		contradictionsFound: 0,
		reinforcementsFound: 0,
	};

	const fullPath = chaseFile.startsWith("/")
		? chaseFile
		: join(config.projectRoot, chaseFile);
	const sourceId = chaseFile
		.replace(/^raw\/chase\//, "")
		.replace(/\.md$/, "")
		.replace(/^\//, "");
	const sourceChase = [sourceId + ".md"];

	// ── Step 1: 命题提取（如果没有 prop marker）──
	const content = readFileSync(fullPath, "utf-8");
	const existingProps = readChaseProps(config, sourceChase);

	// 读取 chase fingerprint（内容哈希）——用于覆盖式 ingest 的权威匹配
	const fpMatch = content.match(/^fingerprint:\s*(\S+)/m);
	const chaseFingerprint = fpMatch ? fpMatch[1] : undefined;

	if (existingProps.length === 0) {
		const llmCaller = async (prompt: string) => {
			const r = await client.chat({
				model: config.model,
				systemPrompt: "",
				messages: [{ role: "user", content: prompt }],
				responseFormat: "json_object",
				thinkingDisabled: true,
				maxTokens: 32768,
			});
			return r.content;
		};
		const propResult = await extractPropositions(content, llmCaller);
		writeFileSync(fullPath, propResult.updatedContent, "utf-8");
		result.propsExtracted = propResult.props.length;
	} else {
		result.propsExtracted = existingProps.length;
	}

	// ── Step 2: 编译 wiki 节点 ──
	const props = readChaseProps(config, sourceChase);
	const propTexts = props
		.map((p) => `[prop ${p.index}] ${p.text}`)
		.join("\n\n");

	const compilePrompt = `你是一个知识编译器。基于以下原子命题编译 wiki 节点。输出 JSON: {"nodeDrafts":[{...}]}。

每个节点含: nodeId/kind/title/claim/evidence/edges。
propRefs 必须是命题的数字索引（如 [1, 2, 7]），不要输出命题文本！
edges 每项含 to(目标nodeId)、type("derived_from" | "related" | "supports" | "superseded_by")、confidence(0-1)。
  * derived_from: 本节点的推理依据来自目标节点
  * related: 与目标节点有语义关联（同主题、同来源、claim相关）
  * supports: 与目标节点在同一主题上证据互相支持
  * superseded_by: 本节点被目标节点取代（目标节点更正或扩展了本节点claim）

# 最重要规则 — 适用于所有 kind（包括 method/insight）
- claim 必须逐句可追溯到 prop 原文——每一个断言都能在命题列表中找到对应的原文句子
- 不添加原文没有的概率保证、策略建议、价值判断
- 不要「保证至少 N%」除非 prop 原文里有这个数字
- 不要「可作为稳健策略」除非 prop 原文里明确建议这样做
- 概念类节点（concept）：直接复述 prop 中的数学/科学事实
- 方法类节点（method）：描述原文中的方法步骤，不添加工具有效性断言
- 洞察类节点（insight）：仅综合 prop 中已明确陈述的关联，不做推测性解读
- limits: 必须列出该 claim 的适用条件或已知限制。如果没有明确的限制条件，写「暂无」

counter 提取（v2 新增）：如果材料中有与主流观点矛盾或提出反例的命题，也编译为 kind=counter 的节点。counter 节点的 claim 应以「通常认为…但…」的形式呈现反方观点。

命题：
${propTexts.slice(0, compileInputBudget(8192))}`;

	const compileResult = await client.chat({
		model: config.model,
		systemPrompt: "",
		messages: [{ role: "user", content: compilePrompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 8192,
	});

	const parsed = JSON.parse(compileResult.content);
	const rawDrafts = Array.isArray(parsed.nodeDrafts)
		? parsed.nodeDrafts
		: Array.isArray(parsed)
			? parsed
			: [];

	// Build drafts with edge tracking
	const drafts: WikiNodeDraft[] = [];
	const draftEdges = new Map<string, any[]>();
	const llmNodeIdMap = new Map<string, string>();

	for (const d of rawDrafts) {
		if (!d.claim) continue;
		const kind: WikiKind = [
			"concept",
			"claim",
			"method",
			"case",
			"equation",
			"question",
			"insight",
			"anchor",
			"counter",
		].includes(d.kind)
			? d.kind
			: "concept";
		const nodeId = d.nodeId || `${kind}-${Date.now()}`;

		if (Array.isArray(d.edges)) draftEdges.set(nodeId, d.edges);
		llmNodeIdMap.set(d.nodeId, nodeId);

		const rawEvidence = Array.isArray(d.evidence) ? d.evidence : [];
		const evidence: Evidence[] = rawEvidence.map((ev: any) => {
			if (typeof ev === "string")
				return { sourceId, propRefs: ["1"], summary: ev.slice(0, 200) };
			return {
				sourceId: ev.sourceId || sourceId,
				// 验证 propRefs 是数字索引（不是命题文本）——纯数字保留，否则回退 "1"
				propRefs: Array.isArray(ev.propRefs)
					? (ev.propRefs as any[]).map(String).filter((r: string) => /^\d+$/.test(r))
					: [],
				summary: ev.summary || "",
			};
		});

		const allPropRefs = [
			...new Set(evidence.flatMap((ev: Evidence) => ev.propRefs)),
		];
		if (allPropRefs.length === 0) allPropRefs.push("1");

		drafts.push({
			nodeId,
			kind,
			filePath: `wiki/${kind}s/${nodeId.replace(/\//g, "-")}.md`,
			frontmatter: {
				title: d.title || nodeId,
				kind,
				sourceIds: [sourceId],
				sourceChase,
				fingerprint: chaseFingerprint,
				propRefs: allPropRefs,
				confidence: 0.75,
				status: "draft",
				tags: d.tags || [],
				createdAt: new Date().toISOString(),
			},
			claim: d.claim || "",
			evidence,
			interpretation: d.interpretation || "",
			useFor: Array.isArray(d.useFor) ? d.useFor : [],
			limits: Array.isArray(d.limits) ? d.limits : [],
		});
	}

	if (drafts.length === 0) return result;

	// Cleanup old nodes + write new ones
	const existingFiles = scanWikiFiles(config.wikiDir);
	for (const fp of existingFiles) {
		const p = parseWikiFile(fp);
		if (p && (
			(chaseFingerprint && p.frontmatter.fingerprint === chaseFingerprint) ||
			p.frontmatter.sourceIds?.includes(sourceId) ||
			p.frontmatter.sourceChase?.includes(sourceChase[0] ?? '')
		)) {
			try {
				unlinkSync(fp);
			} catch {}
		}
	}

	for (const draft of drafts) {
		// Remap edges
		const rawEdges = draftEdges.get(draft.nodeId);
		if (Array.isArray(rawEdges)) {
			for (const e of rawEdges) {
				if (e.to && llmNodeIdMap.has(e.to)) e.to = llmNodeIdMap.get(e.to);
			}
			const compileNodeIds = new Set(drafts.map((d) => d.nodeId));
			const validEdges = rawEdges.filter(
				(e: any) => e.to && e.type && compileNodeIds.has(e.to),
			);
			if (validEdges.length > 0) {
				draft.frontmatter.edges = validEdges.map((e: any) => ({
					from: draft.nodeId,
					to: e.to,
					type:
						e.type === "derived_from" || e.type === "related" || e.type === "supports" || e.type === "superseded_by"
							? e.type
							: "related",
					confidence: typeof e.confidence === "number" ? e.confidence : 0.7,
					source: "compile",
				}));
				result.edgesWritten += validEdges.length;
			}
		}

		const dir = join(config.wikiDir, `${draft.kind}s`);
		mkdirSync(dir, { recursive: true });
		const md = renderWikiNode(draft);
		const outPath = join(dir, `${draft.nodeId.replace(/\//g, "-")}.md`);
		writeFileSync(outPath, md, "utf-8");
		if (draft.frontmatter.edges?.length) {
			const raw = readFileSync(outPath, "utf-8");
			const fixed = raw.replace(
				/^edges:.*$/m,
				`edges: ${JSON.stringify(draft.frontmatter.edges)}`,
			);
			writeFileSync(outPath, fixed, "utf-8");
		}
	}

	result.nodesCompiled = drafts.length;

	// ── Step 3: 审计 ──
	const structResult = auditWiki(config);
	writeAuditResults(config, structResult);

	let semanticOk = false;
	let semanticScore = 0;
	try {
		const semanticResult = await runSemanticAudit(config, {
			llmJudge: async (prompt: string) => {
				const r = await client.chat({
					model: config.model,
					systemPrompt: "",
					messages: [{ role: "user", content: prompt }],
					responseFormat: "json_object",
					thinkingDisabled: true,
					maxTokens: 4096,
				});
				return r.content;
			},
		});
		writeSemanticAuditResults(config, semanticResult);
		semanticOk = semanticResult.ok;
		semanticScore = semanticResult.summary?.averageScore ?? 0;
		writeAuditGate(
			config,
			structResult.ok,
			semanticOk,
			drafts.length,
			semanticScore,
		);
	} catch {}

	result.audit = {
		structure: structResult.ok,
		semantic: semanticOk,
		score: semanticScore,
	};

	// ── Step 4: 矛盾 + 强化检测 ──
	try {
		const { detectContradictions } = await import(
			"../evolution/contradiction.js"
		);
		const { detectReinforcementCandidates } = await import(
			"../evolution/reinforce.js"
		);

		const newNodeIds = new Set(drafts.map((d) => d.nodeId));
		const existingNodes: Array<{
			nodeId: string;
			claim: string;
			kind: string;
		}> = [];
		for (const fp of scanWikiFiles(config.wikiDir)) {
			const p = parseWikiFile(fp);
			if (p && p.nodeId && !newNodeIds.has(p.nodeId)) {
				existingNodes.push({
					nodeId: p.nodeId,
					claim: p.sections.claim,
					kind: p.kind,
				});
			}
		}

		// Finding 3：收集所有候选（矛盾 + 强化）到同一数组，最后一次写入。
		// writeConfirmSection 是替换语义——多次调用会覆盖前面的候选。
		const pendingItems: ConfirmItem[] = [];

		if (existingNodes.length > 0 && drafts.length > 0) {
			const firstDraft = drafts[0]!;
			const sameKind = existingNodes.filter((n) => n.kind === firstDraft.kind);
			if (sameKind.length > 0) {
				const contradictions = await detectContradictions(
					config,
					firstDraft,
					sameKind,
					async (prompt: string) => {
						const r = await client.chat({
							model: config.model,
							systemPrompt: "",
							messages: [{ role: "user", content: prompt }],
							responseFormat: "json_object",
							thinkingDisabled: true,
							maxTokens: 2048,
						});
						return r.content;
					},
				);
				result.contradictionsFound = contradictions.candidates.length;
				contradictions.candidates.forEach((c, i) => {
					pendingItems.push({
						id: `contradict-${Date.now()}-${i}`,
						type: "edge",
						priority: "high" as const,
						summary: `矛盾检测: ${c.nodeA} ↔ ${c.nodeB}`,
						createdAt: new Date().toISOString(),
						status: "pending" as const,
					});
				});
			}
		}

		const reinforceLlm = async (sysPrompt: string, userMsg: string) => {
			const r = await client.chat({
				model: config.model,
				systemPrompt: sysPrompt,
				messages: [{ role: "user", content: userMsg }],
				responseFormat: "json_object",
				thinkingDisabled: true,
				maxTokens: 1024,
			});
			return r.content;
		};
		for (const draft of drafts) {
			const r = await detectReinforcementCandidates(
				draft,
				existingNodes as any,
				reinforceLlm,
			);
			result.reinforcementsFound += r.length;
			r.forEach((c, i) => {
				pendingItems.push({
					id: `reinforce-${Date.now()}-${i}-${draft.nodeId}`,
					type: "reinforce",
					priority: "medium" as const,
					summary: `强化检测: ${c.existingNodeId} ← ${draft.nodeId}`,
					createdAt: new Date().toISOString(),
					status: "pending" as const,
				});
			});
		}

		// 一次写入所有候选（矛盾 + 强化）
		if (pendingItems.length > 0) {
			writeConfirmSection(config.projectRoot || process.cwd(), pendingItems);
		}
	} catch {}

	return result;
}
