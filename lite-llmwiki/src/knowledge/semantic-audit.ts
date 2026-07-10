/**
 * semantic-audit — 语义审查核心
 *
 * 流程（plan 7.4-7.8）：
 * 1. 列出所有 wiki 节点（parseWikiContent）
 * 2. 按 options.source / options.nodeId 过滤
 * 3. 对每个 node：
 *    a. chase 缺失 → 记 error，跳过 LLM
 *    b. propRefs 缺失 → 记 error，跳过 LLM
 *    c. 构造 input + prompt
 *    d. 调 LLM judge
 *    e. 解析响应（失败 → warning + raw 摘要）
 *    f. 失败/异常 → failed（spec 7.7 单 node 隔离）
 *    g. 把 judge verdict 转成 SemanticAuditIssue
 * 4. 汇总
 *
 * LLM judge 通过 options.llmJudge 注入，便于 mock 测试。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
	AppConfig,
	AuditDimension,
	ParsedWikiNode,
	SemanticAuditIssue,
	SemanticAuditResult,
	SemanticJudgeVerdict,
} from "../types.js";
import {
	ChaseNotFoundError,
	resolveChasePath,
	selectPropsContext,
} from "./chase.js";
import {
	buildSemanticAuditInput,
	buildSemanticAuditPrompt,
	parseSemanticAuditResponse,
} from "./semantic-audit-prompt.js";
import {
	WIKI_NODE_DIRS,
	parseWikiContent,
	updateFrontmatter,
} from "./wiki-parser.js";

export interface SemanticAuditOptions {
	/** 按 source 过滤（spec 7.4） */
	source?: string;
	/** 按 nodeId 过滤（spec 7.4） */
	nodeId?: string;
	/**
	 * LLM judge 注入（mock-friendly）。
	 * 必须提供 — 本产品必须有 API key。
	 * 在 CLI 层由 tryMakeLlmJudge 注入。
	 */
	llmJudge?: (prompt: string) => Promise<string>;
}

// ─── 主入口 ────────────────────────────────────────────────────────

export async function runSemanticAudit(
	config: AppConfig,
	options: SemanticAuditOptions = {},
): Promise<SemanticAuditResult> {
	// ── 验证 llmJudge 必须存在 ──
	if (!options.llmJudge) {
		throw new Error(
			"runSemanticAudit requires llmJudge — this product must have an API key. Use registerAuditCommand which injects it.",
		);
	}

	const llmJudge = options.llmJudge; // 保存到局部变量，TypeScript 知道它非 undefined

	const nodes = collectNodes(config, options);
	if (nodes.length === 0) {
		return {
			ok: true,
			summary: { nodes: 0, passed: 0, warning: 0, failed: 0, averageScore: 0 },
			issues: [],
		};
	}

	const issues: SemanticAuditIssue[] = [];
	let passed = 0;
	let warning = 0;
	let failed = 0;
	let totalScore = 0;
	let scoredCount = 0;
	const nodeScores: Record<string, number> = {};

	for (const node of nodes) {
		const nodeResult = await auditOneNode(
			config,
			node,
			options,
			issues,
			llmJudge,
		);
		const { bucket, score } = nodeResult;
		if (bucket === "passed") passed++;
		else if (bucket === "warning") warning++;
		else failed++;
		if (score !== undefined) {
			totalScore += score;
			scoredCount++;
			nodeScores[node.nodeId] = score;
		}
	}

	const averageScore = scoredCount > 0 ? totalScore / scoredCount : 0;
	const ok = failed === 0; // warning 不阻塞，failed 才阻塞（spec 11.2）

	return {
		ok,
		summary: {
			nodes: nodes.length,
			passed,
			warning,
			failed,
			averageScore: Math.round(averageScore * 100) / 100,
		},
		issues,
		nodeScores,
	};
}

// ─── 单 node 审查 ──────────────────────────────────────────────────

interface NodeResult {
	bucket: "passed" | "warning" | "failed";
	score?: number;
}

async function auditOneNode(
	config: AppConfig,
	node: ParsedWikiNode,
	options: SemanticAuditOptions,
	issues: SemanticAuditIssue[],
	llmJudge: (prompt: string) => Promise<string>, // 从 runSemanticAudit 传入
): Promise<NodeResult> {
	const { nodeId, filePath } = node;
	const sourceChase = node.frontmatter.sourceChase ?? [];
	const propRefs = node.frontmatter.propRefs ?? [];

	// ── 早退：chase 缺失（spec 7.7：直接 error，不调 LLM） ──
	const chasePath = resolveChasePath(config, sourceChase);
	if (!chasePath) {
		return failedNoLLM(
			node,
			"citation",
			`chase file not found for sourceChase: ${sourceChase.join(", ") || "(empty)"}`,
			issues,
		);
	}

	// ── 早退：propRefs 缺失（spec 7.7） ──
	if (propRefs.length === 0) {
		return failedNoLLM(node, "citation", "missing propRefs", issues);
	}

	// ── 读 chase excerpts（v2: prop 邻近窗口 ±3）──
	const numPropRefs = propRefs.map(Number).filter((n) => !isNaN(n));
	let excerpts: { index: number; text: string }[];
	try {
		const contextText = selectPropsContext(config, sourceChase, numPropRefs, 3);
		excerpts = [{ index: numPropRefs[0] ?? 0, text: contextText }];
	} catch (e) {
		if (e instanceof ChaseNotFoundError) {
			return failedNoLLM(node, "citation", e.message, issues);
		}
		throw e;
	}

	// ── 调 LLM judge ──
	const input = buildSemanticAuditInput(node, excerpts);
	const prompt = buildSemanticAuditPrompt(input);

	let rawResponse: string;
	try {
		rawResponse = await llmJudge(prompt);
	} catch (e) {
		// LLM 抛错（spec 7.7） → failed
		issues.push({
			nodeId,
			filePath,
			severity: "error",
			dimension: "support",
			claim: node.sections.claim,
			evidenceExcerpt: excerpts[0]?.text ?? "",
			reason: `LLM judge threw: ${(e as Error).message}`,
		});
		return { bucket: "failed" };
	}

	// ── 解析响应 ──
	let verdict: SemanticJudgeVerdict;
	try {
		verdict = parseSemanticAuditResponse(rawResponse, nodeId);
	} catch (e) {
		// JSON 解析失败 / 字段非法（spec 7.7） → warning + raw 摘要
		issues.push({
			nodeId,
			filePath,
			severity: "warning",
			dimension: "support",
			claim: node.sections.claim,
			evidenceExcerpt: excerpts[0]?.text ?? "",
			reason: `LLM response parse failed: ${(e as Error).message}\n--- raw response (first 500 chars) ---\n${rawResponse.slice(0, 500)}`,
		});
		return { bucket: "warning" };
	}

	// ── 把 verdict 转换为 issues ──
	emitVerdictIssues(node, verdict, excerpts, issues);

	// 评分
	switch (verdict.verdict) {
		case "passed":
			return { bucket: "passed", score: verdict.score };
		case "warning":
			return { bucket: "warning", score: verdict.score };
		case "failed":
			return { bucket: "failed", score: verdict.score };
	}
}

function failedNoLLM(
	node: ParsedWikiNode,
	dimension: AuditDimension,
	reason: string,
	issues: SemanticAuditIssue[],
): NodeResult {
	issues.push({
		nodeId: node.nodeId,
		filePath: node.filePath,
		severity: "error",
		dimension,
		claim: node.sections.claim,
		evidenceExcerpt: "",
		reason,
	});
	return { bucket: "failed" };
}

function emitVerdictIssues(
	node: ParsedWikiNode,
	verdict: SemanticJudgeVerdict,
	excerpts: { index: number; text: string }[],
	issues: SemanticAuditIssue[],
): void {
	const { filePath } = node;
	const evidenceExcerpt = excerpts[0]?.text ?? "";

	// 每个非 "ok"/"aligned"/"none" 的维度都可能产出 issue
	const flag = (
		dim: AuditDimension,
		value: string,
		defaultReason: string,
		suggestedFix?: string,
	) => {
		if (value === "ok" || value === "aligned" || value === "none") return;
		const severity: "warning" | "error" =
			verdict.verdict === "failed" ? "error" : "warning";
		issues.push({
			nodeId: node.nodeId,
			filePath,
			severity,
			dimension: dim,
			claim: node.sections.claim,
			evidenceExcerpt,
			reason: defaultReason,
			suggestedFix,
		});
	};

	flag("support", verdict.support, `support is ${verdict.support}`);
	flag("addition", verdict.addition, `addition is ${verdict.addition}`);
	flag("inference", verdict.inference, `inference is ${verdict.inference}`);
	flag("limits", verdict.limits, `limits is ${verdict.limits}`);
	flag("citation", verdict.citation, `citation is ${verdict.citation}`);

	// LLM 报告的具体 issue 列表（按 support/limits/citation 等维度归属）
	for (const issueText of verdict.issues) {
		const dim = inferDimension(issueText);
		const severity: "warning" | "error" =
			verdict.verdict === "failed" ? "error" : "warning";
		issues.push({
			nodeId: node.nodeId,
			filePath,
			severity,
			dimension: dim,
			claim: node.sections.claim,
			evidenceExcerpt,
			reason: issueText,
		});
	}
}

/** 从 issue 文本启发式推断维度（关键词匹配） */
function inferDimension(text: string): AuditDimension {
	const lower = text.toLowerCase();
	if (/propref|prop ref|chunkref|chunk ref|citation|引用.*不覆盖/.test(lower))
		return "citation";
	if (/limit|限制|条件/.test(lower)) return "limits";
	if (/support|支持|claim.*支持/.test(lower)) return "support";
	if (/addition|添加|新.*主张/.test(lower)) return "addition";
	if (/inference|推理/.test(lower)) return "inference";
	return "support"; // 默认
}

// ─── 节点收集 ──────────────────────────────────────────────────────

/** 按 source / nodeId 过滤后收集所有 ParsedWikiNode */
function collectNodes(
	config: AppConfig,
	options: SemanticAuditOptions,
): ParsedWikiNode[] {
	const paths: string[] = [];
	for (const dir of WIKI_NODE_DIRS) {
		const dirPath = join(config.wikiDir, dir);
		if (!existsSync(dirPath)) continue;
		for (const f of readdirSync(dirPath)) {
			if (f.endsWith(".md")) paths.push(join(dirPath, f));
		}
	}

	const nodes: ParsedWikiNode[] = [];
	for (const p of paths) {
		let content: string;
		try {
			content = readFileSync(p, "utf-8");
		} catch {
			continue;
		}
		const node = parseWikiContent(content, p);
		if (node.isLegacy) continue; // 跳过 legacy v4 节点
		if (options.nodeId && node.nodeId !== options.nodeId) continue;
		if (options.source) {
			const sourceChaseVals = node.frontmatter.sourceChase ?? [];
			const sourceChaseRaw = sourceChaseVals[0] ?? "";
			if (!sourceChaseRaw.includes(options.source)) continue;
		}
		nodes.push(node);
	}
	return nodes;
}

// ─── Semantic Audit 结果写回 ─────────────────────────────────────

/** 将语义 audit 结果写回 wiki 节点 frontmatter（auditStatus + auditScore） */
export function writeSemanticAuditResults(
	config: AppConfig,
	result: SemanticAuditResult,
): void {
	const failedNodeIds = new Set<string>();
	const warningNodeIds = new Set<string>();

	for (const issue of result.issues) {
		if (!issue.nodeId) continue;
		if (issue.severity === "error") failedNodeIds.add(issue.nodeId);
		else if (issue.severity === "warning") warningNodeIds.add(issue.nodeId);
	}

	const allNodeFiles = collectNodeFiles(config);

	for (const { nodeId, fullPath } of allNodeFiles) {
		const nodeScore = result.nodeScores?.[nodeId];
		const scoreUpdate =
			nodeScore !== undefined
				? { auditScore: Math.round(nodeScore * 100) / 100 }
				: {};

		if (failedNodeIds.has(nodeId)) {
			updateFrontmatter(fullPath, { auditStatus: "failed", ...scoreUpdate });
		} else if (warningNodeIds.has(nodeId)) {
			updateFrontmatter(fullPath, { auditStatus: "warning", ...scoreUpdate });
		} else {
			updateFrontmatter(fullPath, { auditStatus: "passed", ...scoreUpdate });
		}
	}
}

interface NodeFileEntry {
	nodeId: string;
	filePath: string;
	fullPath: string;
}

function collectNodeFiles(config: AppConfig): NodeFileEntry[] {
	const entries: NodeFileEntry[] = [];
	for (const dir of WIKI_NODE_DIRS) {
		const dirPath = join(config.wikiDir, dir);
		if (!existsSync(dirPath)) continue;
		for (const f of readdirSync(dirPath)) {
			if (!f.endsWith(".md")) continue;
			const fullPath = join(dirPath, f);
			try {
				const content = readFileSync(fullPath, "utf-8");
				const node = parseWikiContent(content, fullPath);
				entries.push({
					nodeId: node.nodeId,
					filePath: `wiki/${dir}/${f}`,
					fullPath,
				});
			} catch {
				continue;
			}
		}
	}
	return entries;
}
