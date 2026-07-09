/**
 * lite-llmwiki — DeepSeek-native terminal knowledge workbench
 *
 * Library entry point. Exports public API for embedders and tests.
 */

export { loadConfig } from "./config.js";
export { KnowledgeStore } from "./knowledge/store.js";
export { renderWikiNode } from "./knowledge/render.js";
export {
	loadFromFile,
	parseFrontmatter,
	chunkText,
	estimateTokens,
} from "./ingest/loader.js";
export { loadFromTex } from "./ingest/tex-loader.js";
export { proIngest } from "./ingest/listening.js";
export { queryKnowledge, type QueryKnowledgeOptions } from "./query/engine.js";
export { searchWiki } from "./query/search.js";
export {
	buildQueryBoard,
	type BuildQueryBoardOptions,
} from "./query/board.js";
export type {
	SearchMatch,
	SearchOptions,
} from "./query/search.js";
export { auditWiki } from "./knowledge/audit.js";

export type {
	AppConfig,
	Source,
	Chunk,
	MainThread,
	Proposition,
	ConfirmedProposition,
	PropConfirm,
	WikiNodeDraft,
	WikiPage,
	HypothesisOption,
	ProResult,
	IngestOptions,
} from "./types.js";

export type {
	AuditResult,
	AuditIssue,
	AuditSummary,
	AuditSeverity,
} from "./knowledge/audit.js";

export {
	parseWikiContent,
	parseWikiFile,
	scanWikiFiles,
	inferKindFromPath,
	WIKI_NODE_DIRS,
	parseStringList,
	parseChunkRefs,
	extractRawId,
	scalar,
} from "./knowledge/wiki-parser.js";
export {
	resolveChasePath,
	readChaseChunks,
	selectChaseChunks,
	getExcerpt,
	collectChunkIndices,
	ChaseNotFoundError,
} from "./knowledge/chase.js";
export type { SelectChaseChunksResult } from "./knowledge/chase.js";
export {
	runSemanticAudit,
	type SemanticAuditOptions,
} from "./knowledge/semantic-audit.js";
export { runQueryCli, registerQueryCommand } from "./cli/commands/query.js";
export { runAuditCli, registerAuditCommand } from "./cli/commands/audit.js";
export {
	runInspireCli,
	registerInspireCommand,
} from "./cli/commands/inspire.js";
export {
	buildFailureJson,
	type AgentFailure,
	type AgentStage,
} from "./agent/contract.js";
export {
	computeClaimHash,
	generateRelatedFor,
	type RelatedNode,
	type RelatedSeed,
} from "./knowledge/manifest.js";
export {
	buildSemanticAuditInput,
	buildSemanticAuditPrompt,
	parseSemanticAuditResponse,
	type SemanticAuditInput,
} from "./knowledge/semantic-audit-prompt.js";
export type {
	ParsedWikiNode,
	ChaseChunk,
	AuditStatus,
	ClaimType,
	InferenceLevel,
	BoardRole,
	BoardMode,
	BoardNode,
	QueryBoard,
	BoardInstruction,
	SearchMatchV6,
	SemanticAuditResult,
	SemanticAuditIssue,
	SemanticJudgeVerdict,
	SemanticVerdict,
	AuditDimension,
	SourceExcerpt,
	BoardGap,
	QueryResultV6,
	QueryBoardSummary,
	WikiClaimRef,
	ModelSynthesis,
	MissingEvidence,
	SuggestedNextAction,
	Usage,
} from "./types.js";
export { BOARD_MODE_ALIASES, normalizeBoardMode } from "./types.js";
