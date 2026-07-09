/**
 * audit-gate — 跨进程审计关卡（spec 11.2）
 *
 * spec 11.2: "在 audit 失败后把 wiki 当可靠来源" 是禁止行为。
 * audit 命令 exit code 2 只阻止当前进程，不阻止后续独立调用 query/inspire。
 *
 * 本模块通过 wiki/index.json 记录最近一次 audit 状态，
 * query/inspire 启动前检查关卡。
 *
 * 关卡逻辑：
 * - index.json 不存在 → 警告（wiki 可能未建）
 * - index.json 存在但无 lastAudit → 警告（未审计）
 * - lastAudit.ok=true → 放行
 * - lastAudit.ok=false → 阻止，输出 spec 11.3 failure shape
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFailureJson } from "../agent/contract.js";
import type { AppConfig } from "../types.js";

export interface LastAuditRecord {
	/** 结构 audit 是否通过 */
	structureOk: boolean;
	/** 语义 audit 是否通过（null = 未执行） */
	semanticOk: boolean | null;
	/** 审计时间 */
	timestamp: string;
	/** 总节点数 */
	nodes: number;
	/** 语义审计平均分（null = 未执行） */
	semanticScore: number | null;
}

export interface AuditGateResult {
	/** 是否放行 */
	passed: boolean;
	/** 警告信息（放行但有风险时） */
	warning?: string;
	/** 阻止时的 spec 11.3 failure JSON */
	failure?: {
		ok: false;
		stage: string;
		error: string;
		blockingIssues: string[];
		suggestedNextActions: string[];
	};
	/** 最近审计记录 */
	lastAudit?: LastAuditRecord;
}

// ─── 读取关卡 ───────────────────────────────────────────────────

const AUDIT_GATE_FILE = "audit-gate.json";

/**
 * 检查审计关卡。
 * 用于 query/inspire 命令启动前验证 wiki 是否通过审计。
 */
export function checkAuditGate(config: AppConfig): AuditGateResult {
	const gatePath = join(config.wikiDir, AUDIT_GATE_FILE);

	// 关卡文件不存在 → 未审计
	if (!existsSync(gatePath)) {
		// 如果 wiki 目录也是空的 → 无数据
		if (
			!existsSync(config.wikiDir) ||
			!existsSync(join(config.wikiDir, "index.json"))
		) {
			return {
				passed: false,
				warning: "wiki is empty — no data to query",
				failure: buildFailureJson({
					stage: "query",
					error: "wiki is empty — run ingest first",
					blockingIssues: ["no-wiki"],
					suggestedNextActions: ["run ingest to populate wiki"],
				}),
			};
		}
		// wiki 有数据但未审计 → 警告，允许查询（spec 11.2 允许 warning gate）
		return {
			passed: true,
			warning:
				"wiki has not been audited — results may not be reliable. Run `audit --json` first.",
		};
	}

	try {
		const content = readFileSync(gatePath, "utf-8");
		const record: LastAuditRecord = JSON.parse(content);

		// 结构 audit 失败 → 阻止
		if (!record.structureOk) {
			return {
				passed: false,
				lastAudit: record,
				failure: buildFailureJson({
					stage: "query",
					error: "structure audit failed — wiki is not reliable (spec 11.2)",
					blockingIssues: ["structure-audit-failed"],
					suggestedNextActions: [
						"run `audit --json` to identify issues",
						"re-ingest if nodes are incorrect",
					],
				}),
			};
		}

		// 语义 audit 失败 → 警告放行（LLM judge 是主观的——不应用主观判断做硬关卡 §06）
		if (record.semanticOk === false) {
			return {
				passed: true,
				warning: `semantic audit found issues (score: ${record.semanticScore}) — claims may not be faithful to source. Agent should check auditStatus on each node before trusting.`,
				lastAudit: record,
			};
		}

		// 结构通过，语义未执行 → 警告放行
		if (record.semanticOk === null) {
			return {
				passed: true,
				warning:
					"structure audit passed but semantic audit not yet run — claims may not be verified. Run `audit --semantic --json`.",
				lastAudit: record,
			};
		}

		// 全部通过 → 放行
		return {
			passed: true,
			lastAudit: record,
		};
	} catch {
		// 关卡文件损坏 → 警告放行
		return {
			passed: true,
			warning:
				"audit gate file is corrupted — treating as un-audited. Run `audit --json`.",
		};
	}
}

// ─── 写入关卡 ───────────────────────────────────────────────────

/**
 * 审计完成后写入关卡记录。
 * 由 audit 命令和 ingest 的自动审计调用。
 */
export function writeAuditGate(
	config: AppConfig,
	structureOk: boolean,
	semanticOk: boolean | null,
	nodes: number,
	semanticScore: number | null,
): void {
	const gatePath = join(config.wikiDir, AUDIT_GATE_FILE);
	const record: LastAuditRecord = {
		structureOk,
		semanticOk,
		timestamp: new Date().toISOString(),
		nodes,
		semanticScore,
	};
	writeFileSync(gatePath, JSON.stringify(record, null, 2), "utf-8");
}
