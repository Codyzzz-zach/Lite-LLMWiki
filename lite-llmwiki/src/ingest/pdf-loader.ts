import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { request as httpsRequest } from "node:https";
import type { AppConfig, Source } from "../types.js";
import { chunkText, estimateTokens } from "./loader.js";

// ─── MinerU Agent API 配置 ───────────────────────────────────────────
//
// Agent 轻量解析 API：免费，无需 Token，IP 限频
// 限制：≤10MB, ≤20 页
// 流程：POST JSON 获取签名 URL → PUT 上传 → GET 轮询 → GET 下载 Markdown

const MINERU_BASE = "https://mineru.net";
const POLL_INTERVAL = 3000;
const MAX_WAIT = 300_000; // 5min — Agent 免费 IP 限频，排队可能较慢

export interface PdfLoadOptions {
  chunkTokenTarget?: number;
  chunkOverlapTokens?: number;
  /** 解析语言: ch|en|japan|korean|latin|... 默认 ch */
  language?: string;
  /** 页码范围: "1-10" 或 "5"，仅 PDF 有效 */
  pageRange?: string;
  /** 兼容旧签名 */
  config?: AppConfig;
}

/**
 * PDF 加载器 — 纯 MinerU Agent 通道
 *
 * 签名上传流程：
 *   1. POST /api/v1/agent/parse/file (JSON body) → { task_id, file_url }
 *   2. PUT  file_url (binary, 无 Content-Type) → 上传完成
 *   3. GET  /api/v1/agent/parse/{task_id} → 轮询直到 state=done
 *   4. GET  markdown_url → 下载 Markdown
 */
export async function loadFromPdf(
  filePath: string,
  options?: PdfLoadOptions,
): Promise<Source> {
  const filename = basename(filePath);
  const name = filename.replace(/\.pdf$/i, "");
  const language = options?.language ?? "ch";

  // ── Step 1: 获取签名上传 URL ──
  console.error("  [PDF] MinerU Agent: requesting signed upload URL...");
  const applyBody: Record<string, unknown> = {
    file_name: filename,
    language,
    enable_table: true,
    is_ocr: false,
    enable_formula: true,
  };
  if (options?.pageRange) applyBody.page_range = options.pageRange;

  const applyRes = await fetch(`${MINERU_BASE}/api/v1/agent/parse/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(applyBody),
  });
  if (!applyRes.ok) {
    const err = await applyRes.text().catch(() => "");
    throw new Error(`Agent apply failed (${applyRes.status}): ${err.slice(0, 300)}`);
  }
  const applyData = (await applyRes.json()) as any;
  if (applyData.code !== 0) {
    throw new Error(`Agent apply error: ${applyData.msg ?? "unknown"} (code=${applyData.code})`);
  }

  const taskId = applyData.data?.task_id;
  const fileUrl = applyData.data?.file_url;
  if (!taskId || !fileUrl) {
    throw new Error(`Agent: no task_id/file_url: ${JSON.stringify(applyData).slice(0, 300)}`);
  }
  console.error(`  [PDF] MinerU Agent: task_id=${taskId}, uploading file...`);

  // ── Step 2: PUT 上传文件到签名 URL ──
  const fileBuf = readFileSync(filePath);
  const uploadStatus = await putToOss(fileUrl, fileBuf);
  if (uploadStatus < 200 || uploadStatus >= 300) {
    throw new Error(`Agent upload failed (HTTP ${uploadStatus})`);
  }
  console.error("  [PDF] MinerU Agent: upload done, waiting for parse...");

  // ── Step 3: 轮询解析结果 ──
  const start = Date.now();
  let markdownUrl = "";
  while (Date.now() - start < MAX_WAIT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const pollRes = await fetch(`${MINERU_BASE}/api/v1/agent/parse/${taskId}`);
    if (!pollRes.ok) continue;
    const pollData = (await pollRes.json()) as any;
    const state = pollData?.data?.state;

    if (state === "done") {
      markdownUrl = pollData?.data?.markdown_url ?? "";
      if (markdownUrl) break;
    }
    if (state === "failed") {
      const errCode = pollData?.data?.err_code;
      const errMsg = pollData?.data?.err_msg ?? "unknown";
      throw new Error(`Agent parsing failed (err_code=${errCode}): ${errMsg}`);
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.error(`  [PDF] MinerU Agent: [${elapsed}s] state=${state}...`);
  }
  if (!markdownUrl) throw new Error(`Agent: timeout — no result within ${MAX_WAIT / 1000}s`);

  // ── Step 4: 下载 Markdown ──
  console.error("  [PDF] MinerU Agent: downloading Markdown...");
  const mdRes = await fetch(markdownUrl);
  if (!mdRes.ok) throw new Error(`Agent download failed: ${mdRes.status}`);
  const body = (await mdRes.text()).trim();
  if (body.length < 50) throw new Error("Agent returned near-empty content");

  return buildSource(filePath, name, body, options);
}

// ─── OSS 签名上传 ────────────────────────────────────────────────────
//
// OSS 签名 URL 签名时 Content-Type 为空，
// 所以 PUT 时也必须不设 Content-Type（否则 SignatureDoesNotMatch 403）。
// Node.js fetch 对 Buffer body 会自动加 Content-Type，所以用 https.request 手动控制。

function putToOss(url: string, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "PUT",
        headers: { "Content-Length": String(body.length) },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── 输出构建 ────────────────────────────────────────────────────────

function buildSource(
  filePath: string,
  name: string,
  body: string,
  options?: PdfLoadOptions,
): Source {
  const title = extractTitle(body) ?? name;
  const fingerprint = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const id = `raw/pdf/${name}-${fingerprint}`;

  const targetTokens = options?.chunkTokenTarget ?? 2000;
  const overlapTokens = options?.chunkOverlapTokens ?? 200;
  const rawChunks = chunkText(body, targetTokens, overlapTokens);

  let charPos = 0;
  const chunks = rawChunks.map((text, index) => {
    const tokenEst = estimateTokens(text);
    const start = body.indexOf(text.slice(0, 40), charPos);
    const end = Math.min(body.length, (start >= 0 ? start : charPos) + text.length);
    if (start >= 0) charPos = end;
    return {
      id: `${id}-#${index}`,
      index,
      text,
      tokenEstimate: tokenEst,
      charStart: Math.max(0, start),
      charEnd: end,
    };
  });

  return {
    id,
    path: filePath,
    type: "pdf",
    title,
    meta: { engine: "mineru-agent" },
    body,
    chunks,
    totalTokens: estimateTokens(body),
    createdAt: new Date(),
    fingerprint,
  };
}

function extractTitle(body: string): string | null {
  const match = body.match(/^#\s+(.+)/m);
  return match ? match[1]!.trim() : null;
}
