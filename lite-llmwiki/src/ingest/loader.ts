import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Chunk, Source } from "../types.js";

export interface FrontmatterData {
  title?: string;
  author?: string;
  date?: string;
  tags?: string;
  [key: string]: unknown;
}

export interface ParsedMarkdown {
  frontmatter: FrontmatterData;
  body: string;
}

/**
 * 解析 markdown frontmatter (--- 包围的 YAML-like 块)
 *
 * 限制：仅支持单行键值对（`key: value`），不支持多行 YAML 值。
 * MVP 够用；v2.x 引入 yaml 库支持嵌套和多行。
 */
export function parseFrontmatter(text: string): ParsedMarkdown {
  const body = text.trimStart();
  if (!body.startsWith("---")) {
    return { frontmatter: {}, body };
  }
  const endIdx = body.indexOf("---", 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body };
  }
  const raw = body.slice(3, endIdx).trim();
  const frontmatter: FrontmatterData = {};
  for (const line of raw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key) frontmatter[key] = value;
    }
  }
  return { frontmatter, body: body.slice(endIdx + 3).trim() };
}

/**
 * 简单 token 估算
 * 英文：~4 chars/token；中文：~2 chars/token
 * 精度足够，不在 MVP 引入完整 tokenizer
 */
export function estimateTokens(text: string): number {
  let count = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(char)) {
      count += 2;
    } else if (char === " " || char === "\n" || char === "\t") {
      count += 1;
    } else {
      count += 0.25; // 约 4 字符 / token
    }
  }
  return Math.ceil(count);
}

/**
 * 分块：滑动窗口，带重叠
 *
 * 策略：
 * - 按段落 ("\n\n") 分，避免在段落中间截断
 * - 段落合并到 target token 数，超过时以段落边界切分
 * - 每个 chunk 末尾保留 overlap tokens 的哨兵（与下一 chunk 开头重叠）
 */
export function chunkText(text: string, targetTokens: number, overlapTokens: number): string[] {
  // 先按段落分
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    if (currentTokens + paraTokens <= targetTokens) {
      current.push(para);
      currentTokens += paraTokens;
    } else {
      // 保存当前 chunk
      if (current.length > 0) {
        chunks.push(current.join("\n\n"));
      }
      // 新 chunk 从当前段落开始
      current = [para];
      currentTokens = paraTokens;
    }
  }
  // 最后的 chunk
  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  // 重叠：在每个 chunk 末尾追加下一个 chunk 的开头（按字符重叠，粗粒度）
  if (chunks.length > 1 && overlapTokens > 0) {
    for (let i = 0; i < chunks.length - 1; i++) {
      const next = chunks[i + 1]!;
      // 取下一 chunk 开头约 overlapTokens 的文本
      const overlapLen = Math.min(next.length, Math.ceil(overlapTokens * 4)); // ~4 chars/token
      const overlap = next.slice(0, overlapLen);
      chunks[i] = `${chunks[i]}\n\n[overlap-sentinel]\n${overlap}`;
    }
  }

  return chunks;
}

/**
 * 从文件路径加载 Source
 */
export function loadFromFile(filePath: string, options?: {
  chunkTokenTarget?: number;
  chunkOverlapTokens?: number;
}): Source {
  const raw = readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const filename = basename(filePath);
  const title = frontmatter.title ?? filename.replace(/\.md$/, "");

  // 内容指纹（去重用）
  const fingerprint = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const id = `raw/md/${filename.replace(/\.md$/, "")}-${fingerprint}`;

  const targetTokens = options?.chunkTokenTarget ?? 2000;
  const overlapTokens = options?.chunkOverlapTokens ?? 200;
  const rawChunks = chunkText(body, targetTokens, overlapTokens);

  let charPos = 0;
  const chunks: Chunk[] = rawChunks.map((text, index) => {
    const tokenEst = estimateTokens(text);
    const start = body.indexOf(text.slice(0, 40), charPos);
    const end = start + text.length;
    if (start >= 0) charPos = end;
    return {
      id: `${id}-#${index}`,
      index,
      text,
      tokenEstimate: tokenEst,
      charStart: Math.max(0, start),
      charEnd: Math.max(0, end),
    };
  });

  return {
    id,
    path: filePath,
    type: "md",
    title,
    meta: frontmatter as Record<string, string>,
    body,
    chunks,
    totalTokens: estimateTokens(body),
    createdAt: new Date(),
    fingerprint,
  };
}
