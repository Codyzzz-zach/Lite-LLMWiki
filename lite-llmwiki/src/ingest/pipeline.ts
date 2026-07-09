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
edges 每项含 to(目标nodeId)、type("derived_from"或"related")、confidence(0-1)。

命题：
${propTexts.slice(0, 12000)}`;

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
				propRefs: Array.isArray(ev.propRefs) ? ev.propRefs.map(String) : ["1"],
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
		if (p && p.frontmatter.sourceIds?.includes(sourceId)) {
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
						e.type === "derived_from" || e.type === "related"
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
		}
	} catch {}

	return result;
}
