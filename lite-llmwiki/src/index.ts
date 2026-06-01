/**
 * lite-llmwiki — DeepSeek-native terminal knowledge workbench
 *
 * Library entry point. Exports public API for embedders and tests.
 */

export { loadConfig } from "./config.js";
export { KnowledgeStore } from "./knowledge/store.js";
export { loadFromFile, parseFrontmatter, chunkText, estimateTokens } from "./ingest/loader.js";
export { loadFromTex } from "./ingest/tex-loader.js";
export { proIngest } from "./ingest/listening.js";
export { queryKnowledge } from "./query/engine.js";

export type {
  AppConfig,
  Source,
  Chunk,
  MainThread,
  Proposition,
  ConfirmedProposition,
  PropConfirm,
  WikiPage,
  HypothesisOption,
  ProResult,
  IngestOptions,
} from "./types.js";
