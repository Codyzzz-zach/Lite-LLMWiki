/**
 * lite-llmwiki — DeepSeek-native terminal knowledge workbench
 *
 * Library entry point. Exports public API for embedders and tests.
 */

export { loadConfig } from "./config.js";
export { KnowledgeStore } from "./knowledge/store.js";
export { renderWikiNode } from "./knowledge/render.js";
export { loadFromFile, parseFrontmatter, chunkText, estimateTokens } from "./ingest/loader.js";
export { loadFromTex } from "./ingest/tex-loader.js";
export { proIngest } from "./ingest/listening.js";
export { queryKnowledge } from "./query/engine.js";
export { searchWiki } from "./query/search.js";
export type {
  QueryOptions,
  QueryResult,
  QuerySource,
} from "./query/engine.js";
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
