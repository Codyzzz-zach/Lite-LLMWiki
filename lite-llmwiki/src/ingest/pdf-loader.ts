import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { AppConfig, Source } from "../types.js";
import { chunkText, estimateTokens } from "./loader.js";

const MINERU_AGENT = "https://mineru.net/api/v1/agent/parse";
const POLL_INTERVAL = 3000;
const MAX_WAIT = 120_000;

export async function loadFromPdf(filePath: string, options?: {
  chunkTokenTarget?: number;
  chunkOverlapTokens?: number;
  config?: AppConfig;
}): Promise<Source> {
  const filename = basename(filePath);
  const name = filename.replace(/\.pdf$/i, "");

  // 1. MinerU Agent API: 直接上传 PDF
  console.error("  [PDF] uploading to MinerU Agent API...");
  const fileBuf = readFileSync(filePath);
  const blob = new Blob([fileBuf], { type: "application/pdf" });
  const form = new FormData();
  form.append("file", blob, filename);

  const submitRes = await fetch(`${MINERU_AGENT}/file`, {
    method: "POST",
    body: form,
  });
  if (!submitRes.ok) {
    const err = await submitRes.text().catch(() => "");
    throw new Error(`MinerU submit failed (${submitRes.status}): ${err.slice(0, 200)}`);
  }
  const submitData = await submitRes.json() as any;
  const taskId = submitData?.data?.task_id;
  if (!taskId) throw new Error(`MinerU: no task_id in response: ${JSON.stringify(submitData).slice(0, 200)}`);
  console.error("  [PDF] submitted, task_id:", taskId);

  // 2. 轮询等待解析完成
  const start = Date.now();
  let mdUrl = "";
  while (Date.now() - start < MAX_WAIT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const pollRes = await fetch(`${MINERU_AGENT}/result/${taskId}`);
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json() as any;
    const state = pollData?.data?.state;
    if (state === "done") {
      mdUrl = pollData?.data?.result_url ?? "";
      if (mdUrl) break;
    }
    if (state === "failed") {
      throw new Error(`MinerU parsing failed: ${pollData?.data?.err_msg ?? "unknown"}`);
    }
    console.error("  [PDF] still parsing...");
  }
  if (!mdUrl) throw new Error("MinerU: parsing timeout or no result URL");

  // 3. 下载解析后的 Markdown
  console.error("  [PDF] downloading result...");
  const mdRes = await fetch(mdUrl);
  if (!mdRes.ok) throw new Error(`MinerU download failed: ${mdRes.status}`);
  const cleanedBody = (await mdRes.text()).trim();
  if (cleanedBody.length < 50) throw new Error("MinerU returned near-empty content");

  // 4. 提取标题
  const titleMatch = cleanedBody.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1]!.trim() : name;

  // 5. 指纹
  const fingerprint = createHash("sha256").update(cleanedBody).digest("hex").slice(0, 16);
  const id = `raw/pdf/${name}-${fingerprint}`;

  // 6. 分块
  const targetTokens = options?.chunkTokenTarget ?? 2000;
  const overlapTokens = options?.chunkOverlapTokens ?? 200;
  const rawChunks = chunkText(cleanedBody, targetTokens, overlapTokens);

  let charPos = 0;
  const chunks = rawChunks.map((text, index) => {
    const tokenEst = estimateTokens(text);
    const start = cleanedBody.indexOf(text.slice(0, 40), charPos);
    const end = Math.min(cleanedBody.length, (start >= 0 ? start : charPos) + text.length);
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
    meta: { format: "pdf", source: "mineru-agent" },
    body: cleanedBody,
    chunks,
    totalTokens: estimateTokens(cleanedBody),
    createdAt: new Date(),
    fingerprint,
  };
}
