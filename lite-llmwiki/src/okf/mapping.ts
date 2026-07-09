/**
 * mapping — OKF ↔ LiteWikiagent 字段映射
 *
 * OKF v0.1: type (required), title, description, resource, tags, timestamp
 * LiteWikiagent: kind, title, confidence, auditStatus, propRefs, edges, etc.
 */

import type { WikiKind } from "../types.js";

/** LiteWikiagent kind → OKF type */
const KIND_TO_OKF_TYPE: Record<WikiKind, string> = {
	concept: "Concept",
	claim: "Claim",
	method: "Method",
	case: "Case",
	equation: "Equation",
	question: "Question",
	insight: "Insight",
	anchor: "Anchor",
	counter: "Counter",
};

/** OKF type → LiteWikiagent kind（best-effort 反向映射） */
const OKF_TYPE_TO_KIND: Record<string, WikiKind> = {
	concept: "concept",
	claim: "claim",
	method: "method",
	case: "case",
	equation: "equation",
	question: "question",
	insight: "insight",
	anchor: "anchor",
	counter: "counter",
	// common OKF types → LiteWikiagent fallbacks
	"bigquery table": "concept",
	"bigquery dataset": "concept",
	"api endpoint": "method",
	metric: "equation",
	playbook: "method",
	reference: "concept",
};

export function kindToOkfType(kind: WikiKind): string {
	return KIND_TO_OKF_TYPE[kind] ?? "Concept";
}

export function okfTypeToKind(type: string): WikiKind {
	const lower = type.toLowerCase().trim();
	return OKF_TYPE_TO_KIND[lower] ?? "concept";
}
