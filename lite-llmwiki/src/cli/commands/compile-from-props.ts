import { join } from "node:path";
import { writeAuditGate } from "../../knowledge/audit-gate.js";
/**
 * compile-from-props CLI —— 从 prop marker 直接编译 wiki 节点
 *
 * 跳过 v5 的 extract→confirm→compile 老管线。
 * 新管线：chase（含 prop marker）→ LLM compile → wiki 节点（带 propRefs）
 *
 * 用法：
 *   llmwiki compile-from-props "raw/chase/my-paper.md" --auto --json
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { DeepSeekClient } from "../../core/client.js";
import { auditWiki, writeAuditResults } from "../../knowledge/audit.js";
import { readChaseProps } from "../../knowledge/chase.js";
import { renderWikiNode } from "../../knowledge/render.js";
import {
	runSemanticAudit,
	writeSemanticAuditResults,
} from "../../knowledge/semantic-audit.js";
import {
	WIKI_NODE_DIRS,
	parseWikiContent,
} from "../../knowledge/wiki-parser.js";
import { parseWikiFile, scanWikiFiles } from "../../knowledge/wiki-parser.js";
import { compileInputBudget } from "../../ingest/pipeline.js";
import type {
	Evidence,
	WikiKind,
	WikiNodeDraft,
} from "../../types.js";

export function registerCompileFromPropsCommand(program: Command): void {
	program
		.command("compile-from-props")
		.description(
			"Compile wiki nodes directly from chase file with prop markers",
		)
		.argument("<chase-file>", "Path to chase file with prop markers")
		.option("--auto", "Skip confirmation, auto-accept all nodes")
		.option("--json", "Output JSON result")
		.option("--no-audit", "Skip audit step")
		.action(
			async (
				chasePath: string,
				options: { auto?: boolean; json?: boolean; noAudit?: boolean },
			) => {
				const config = loadConfig();
				const client = new DeepSeekClient(config);

				// Resolve chase path
				const fullPath = chasePath.startsWith("/")
					? chasePath
					: join(config.projectRoot, chasePath);

				let content: string;
			let chaseFingerprint: string | undefined = undefined;
				try {
					content = readFileSync(fullPath, "utf-8");

				// 读取 chase fingerprint（内容哈希）
				const fpMatch = content.match(/^fingerprint:\s*(\S+)/m);
				chaseFingerprint = fpMatch ? fpMatch[1] : undefined;
				} catch {
					console.error(`❌ Chase file not found: ${fullPath}`);
					process.exit(1);
				}

				// Parse prop markers
				const sourceChase = [
					chasePath.replace(/^raw\/chase\//, "").replace(/^\//, ""),
				];
				const props = readChaseProps(config, sourceChase);

				if (props.length === 0) {
					console.error(
						"❌ No prop markers found in chase file. Run extract-props first.",
					);
					process.exit(2);
				}

				console.error(`📋 Found ${props.length} propositions in chase file`);

				// Build compile prompt
				const propTexts = props
					.map((p, i) => `[prop ${p.index}] ${p.text}`)
					.join("\n\n");
				const sourceId = sourceChase[0]!.replace(/\.md$/, "");

				const prompt = `你是一个知识编译器。请基于以下原子命题，编译出 wiki 知识节点。

# 命题列表
${propTexts.slice(0, compileInputBudget(16384))}

# 要求
输出 JSON 对象，nodeDrafts 字段包含节点数组。每个节点包含：
- nodeId: 英文短横线标识
- kind: 从 concept/claim/method/case/equation/question/insight/anchor/counter 中选择
- title: 中文标题
- claim: 综合多个命题的核心主张（1-3句话）
- evidence: 证据数组，每项包含 sourceId("${sourceId}")、propRefs(["1","2"]引用命题编号)、summary
- interpretation: 你的解读
- useFor: 适用场景
- limits: 限制条件
- edges: 与其他节点的关系数组。每项含 to(目标nodeId)、type("derived_from" | "related" | "supports" | "superseded_by")、confidence(0-1，你对这个关系的把握程度)。
  * derived_from: 本节点的推理依据来自目标节点
  * related: 与目标节点有语义关联（同主题、同来源、claim相关）
  * supports: 与目标节点在同一主题上证据互相支持
  * superseded_by: 本节点被目标节点取代（目标节点更正或扩展了本节点claim）

# 原则
- 3-6个节点即可——将相近命题聚合为综合概念
- claim 必须基于命题原文——不编造
- 优先 concept/claim/method 类型
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

- 如果节点间存在推理依赖或语义关联，务必标注 edges`;

				console.error("🤖 Compiling wiki nodes...");

				try {
					const result = await client.chat({
						model: config.model,
						systemPrompt: "",
						messages: [{ role: "user", content: prompt }],
						responseFormat: "json_object",
						thinkingDisabled: true,
						maxTokens: 16384,
					});

					const parsed = JSON.parse(result.content);
					const drafts: WikiNodeDraft[] = [];
					const draftEdges = new Map<string, any[]>();
					const llmNodeIdMap = new Map<string, string>(); // LLM nodeId → real nodeId // nodeId → LLM edges
					const rawDrafts = Array.isArray(parsed.nodeDrafts)
						? parsed.nodeDrafts
						: Array.isArray(parsed)
							? parsed
							: [];

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
						const nodeId = d.nodeId || `concept/${kind}-${Date.now()}`;
						const title = d.title || nodeId;

						// Normalize evidence — handles both objects and plain strings
						const rawEvidence = Array.isArray(d.evidence) ? d.evidence : [];
						const evidence: Evidence[] = rawEvidence.map((ev: any) => {
							if (typeof ev === "string") {
								return { sourceId, propRefs: ["1"], summary: ev.slice(0, 200) };
							}
							return {
								sourceId: ev.sourceId || sourceId,
								propRefs: Array.isArray(ev.propRefs)
									? ev.propRefs.map(String)
									: ev.propRef
										? [String(ev.propRef)]
										: ["1"],
								summary: ev.summary || ev.text || "",
							};
						});

						// Collect all propRefs — default to ["1"] if LLM didn't provide
						const allPropRefs = [
							...new Set([...evidence.flatMap((ev: Evidence) => ev.propRefs)]),
						];
						if (allPropRefs.length === 0) allPropRefs.push("1");

						if (Array.isArray(d.edges)) draftEdges.set(nodeId, d.edges);
						llmNodeIdMap.set(d.nodeId, nodeId);

						drafts.push({
							nodeId,
							kind,
							filePath: `wiki/${kind}s/${nodeId.replace(/\//g, "-")}.md`,
							frontmatter: {
								title,
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
							// no-op: edges stored in draftEdges map below
						});
					}

					if (drafts.length === 0) {
						console.error("❌ No valid wiki nodes compiled");
						process.exit(3);
					}

					// ── Write compile-derived edges (derived_from/related) → direct, no confirmation ──
					// Build LLM nodeId → real nodeId mapping (LLM uses short ids like "node1")
					const llmToReal = new Map<string, string>();
					for (const d of drafts) {
						const llmId = (d as any)._llmNodeId; // temporarily stored during parsing
						if (llmId) llmToReal.set(llmId, d.nodeId);
					}
					const compileNodeIds = new Set(drafts.map((d) => d.nodeId));
					for (const draft of drafts) {
						const rawEdges = draftEdges.get(draft.nodeId);
						// Remap LLM nodeIds to real nodeIds
						if (Array.isArray(rawEdges)) {
							for (const e of rawEdges) {
								if (e.to && llmToReal.has(e.to)) e.to = llmToReal.get(e.to);
							}
						}
						if (Array.isArray(rawEdges)) {
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
									confidence:
										typeof e.confidence === "number" &&
										e.confidence >= 0 &&
										e.confidence <= 1
											? e.confidence
											: 0.7,
									source: "compile",
								}));
							}
						}
					}

					// ── Cleanup: 删除同 source 的旧节点（覆盖式 ingest）──
					const existingFiles = scanWikiFiles(config.wikiDir);
					let cleaned = 0;
					for (const fp of existingFiles) {
						const p = parseWikiFile(fp);
						if (p && (
						(chaseFingerprint && p.frontmatter.fingerprint === chaseFingerprint) ||
						p.frontmatter.sourceIds?.includes(sourceId) ||
						p.frontmatter.sourceChase?.includes(sourceChase[0] ?? '')
					)) {
							try {
								unlinkSync(fp);
								cleaned++;
							} catch {
								/* skip */
							}
						}
					}
					if (cleaned > 0)
						console.error(
							`🧹 Removed ${cleaned} old nodes from source: ${sourceId}`,
						);

					// Write wiki nodes
					let written = 0;
					for (const draft of drafts) {
						const dir = join(config.wikiDir, `${draft.kind}s`);
						mkdirSync(dir, { recursive: true });
						const fileName = draft.nodeId.replace(/\//g, "-") + ".md";
						const md = renderWikiNode(draft);
						const outPath = join(dir, fileName);
						writeFileSync(outPath, md, "utf-8");
						// Patch: renderWikiNode breaks object arrays → fix edges as JSON
						if (draft.frontmatter.edges && draft.frontmatter.edges.length > 0) {
							const raw = readFileSync(outPath, "utf-8");
							const edgeJson = JSON.stringify(draft.frontmatter.edges);
							// Replace broken edges: line with valid JSON
							const fixed = raw.replace(/^edges:.*$/m, `edges: ${edgeJson}`);
							writeFileSync(outPath, fixed, "utf-8");
						}
						written++;
					}

					console.error(`✅ Compiled ${written} wiki nodes`);

					// Run audit
					let auditResult: any = null;
					if (!options.noAudit) {
						console.error("🔍 Running structure audit...");
						const structResult = auditWiki(config);
						writeAuditResults(config, structResult);

						console.error("🔍 Running semantic audit...");
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
							writeAuditGate(
								config,
								structResult.ok,
								semanticResult.ok,
								written,
								semanticResult.summary?.averageScore ?? null,
							);
							auditResult = {
								structure: { ok: structResult.ok },
								semantic: {
									ok: semanticResult.ok,
									averageScore: semanticResult.summary?.averageScore,
								},
							};
							console.error(
								`✅ Audit complete: structure=${structResult.ok}, semantic=${semanticResult.ok}, score=${semanticResult.summary?.averageScore}`,
							);
						} catch (e) {
							console.error(`⚠️ Semantic audit failed: ${(e as Error).message}`);
						}
					}

					// ── Post-compile: 矛盾检测 + 强化检测 ──
					let edgeCandidates = 0;
					try {
						const { detectContradictions, contradictionsToEdges } =
							await import("../../evolution/contradiction.js");
						const { detectReinforcementCandidates } = await import(
							"../../evolution/reinforce.js"
						);
						const { writeConfirmSection } = await import(
							"../../evolution/confirm.js"
						);
						const { scanWikiFiles, parseWikiFile } = await import(
							"../../knowledge/wiki-parser.js"
						);

						// 收集已有节点（排除刚编译的）
						const newNodeIds = new Set(drafts.map((d) => d.nodeId));
						const existingNodes: Array<{
							nodeId: string;
							claim: string;
							kind: string;
							auditScore?: number;
						}> = [];
						const allFiles = scanWikiFiles(config.wikiDir);
						for (const fp of allFiles) {
							const p = parseWikiFile(fp);
							if (p && p.nodeId && !newNodeIds.has(p.nodeId)) {
								existingNodes.push({
									nodeId: p.nodeId,
									claim: p.sections.claim,
									kind: p.kind,
									auditScore: p.frontmatter.auditScore,
								});
							}
						}

						const items: Array<{
							id: string;
							type:
								| "edge"
								| "reflow"
								| "supersede"
								| "reinforce"
								| "semantic_issue";
							priority: "medium";
							summary: string;
							createdAt: string;
							status: "pending";
						}> = [];

						// 矛盾检测：只对第一批 draft 调 LLM（避免超时），其余批仅做强化
						if (existingNodes.length > 0 && drafts.length > 0) {
							const firstDraft = drafts[0]!;
							const sameKindExisting = existingNodes.filter(
								(n) => n.kind === firstDraft.kind,
							);
							if (sameKindExisting.length > 0) {
								const contradictions = await detectContradictions(
									config,
									firstDraft,
									sameKindExisting,
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
								for (const c of contradictions.candidates) {
									items.push({
										id: `contradict-${Date.now()}-${items.length}`,
										type: "edge",
										priority: "medium",
										summary: `[${c.nodeA}→${c.nodeB}] contradicts: ${c.reason.slice(0, 80)}`,
										createdAt: new Date().toISOString(),
										status: "pending",
									});
								}
								edgeCandidates += contradictions.candidates.length;
							}
						}

						// 强化检测（LLM judge 双维度：语义一致度 + 证据增量度）
						const reinforceLlmCaller = async (
							sysPrompt: string,
							userMsg: string,
						) => {
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
							const reinforcements = await detectReinforcementCandidates(
								draft,
								existingNodes,
								reinforceLlmCaller,
							);
							for (const r of reinforcements) {
								items.push({
									id: `reinforce-${Date.now()}-${items.length}`,
									type: "reinforce",
									priority: "medium",
									summary: `[${r.supportingNodeId}→${r.existingNodeId}] supports: ${r.reason.slice(0, 80)}`,
									createdAt: new Date().toISOString(),
									status: "pending",
								});
							}
						}

						if (items.length > 0) {
							writeConfirmSection(config.projectRoot || process.cwd(), items);
							console.error(
								`🔗 Post-compile: ${edgeCandidates} contradictions, ${items.length - edgeCandidates} reinforcements → progress.md`,
							);
						} else {
							console.error(
								`🔗 Post-compile: no candidates found (compared against ${existingNodes.length} existing nodes)`,
							);
						}
					} catch (e) {
						console.error(
							`⚠️  Post-compile detection failed: ${(e as Error).message}`,
						);
					}

					if (options.json) {
						console.log(
							JSON.stringify(
								{
									ok: true,
									compiled: written,
									nodes: drafts.map((d) => ({
										nodeId: d.nodeId,
										kind: d.kind,
										title: d.frontmatter.title,
									})),
									audit: auditResult,
								},
								null,
								2,
							),
						);
					} else {
						console.log(`\n📊 Compilation complete:`);
						console.log(`   Nodes: ${written}`);
						for (const d of drafts) {
							console.log(
								`   - [${d.kind}] ${d.frontmatter.title} (${d.nodeId})`,
							);
						}
					}
				} catch (err) {
					console.error(
						`❌ Compilation failed: ${err instanceof Error ? err.message : String(err)}`,
					);
					process.exit(2);
				}
			},
		);
}
