import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { AppConfig, Source } from "../types.js";
import { DeepSeekClient } from "../core/client.js";
import { chunkText, estimateTokens } from "./loader.js";

export interface PdfMeta {
  title?: string;
  author?: string;
  pages: number;
  [key: string]: unknown;
}

const PDF_CLEAN_PROMPT = `你收到的是从 PDF 中通过程序提取的纯文本，表格、公式、标题层级可能已经丢失。
请将其恢复为结构化的 Markdown，规则：
- 识别标题行，用 ## 或 ### 标记层级
- 表格数据用 | 分隔对齐
- 公式用 $$ 包裹
- 保持段落完整
- 参考文献保留原格式
- 只输出 Markdown，不要解释`;

export async function loadFromPdf(filePath: string, options?: {
  chunkTokenTarget?: number;
  chunkOverlapTokens?: number;
  config?: AppConfig;
}): Promise<Source> {
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  const name = filename.replace(/\.pdf$/i, "");

  // 1. pdf-parse 快速提取原始文本
  const result = await pdfParse(buffer);
  const body = result.text?.trim() ?? "";
  if (body.length < 10) {
    throw new Error(
      `PDF text extraction returned near-empty content (${body.length} chars). ` +
      "This may be a scanned document. For scanned PDFs, use OCR first."
    );
  }

  const totalPages: number = result.numpages ?? 0;
  const info = result.info ?? {};
  const rawTitle = String(info.Title ?? name);

  // 2. Pro 清洗为结构化 Markdown
  let cleanedBody: string;
  let finalTitle = rawTitle;

  const config = options?.config;
  if (config?.apiKey) {
    console.error("  [PDF] cleaning with DeepSeek...");
    const client = new DeepSeekClient(config);
    try {
      const cleanResult = await client.chat({
        model: config.model,
        systemPrompt: PDF_CLEAN_PROMPT,
        messages: [{ role: "user", content: body }],
        responseFormat: "text",
        maxTokens: 16384,
      });
      cleanedBody = cleanResult.content.trim();
      // 从 cleaned body 中提取第一个 # 标题作为 title
      const titleMatch = cleanedBody.match(/^#\s+(.+)/m);
      if (titleMatch) finalTitle = titleMatch[1]!.trim();
    } catch (err) {
      console.error(`  [PDF] cleaning failed, using raw text: ${(err as Error).message}`);
      cleanedBody = body;
    }
  } else {
    console.error("  [PDF] no API key, using raw text (no cleaning)");
    cleanedBody = body;
  }

  // 3. 内容指纹
  const fingerprint = createHash("sha256").update(cleanedBody).digest("hex").slice(0, 16);
  const id = `raw/pdf/${name}-${fingerprint}`;

  // 4. 分块
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

  const meta: PdfMeta = { title: finalTitle, author: String(info.Author ?? ""), pages: totalPages };

  return {
    id,
    path: filePath,
    type: "pdf",
    title: finalTitle,
    meta: meta as unknown as Record<string, string>,
    body: cleanedBody,
    chunks,
    totalTokens: estimateTokens(cleanedBody),
    createdAt: new Date(),
    fingerprint,
  };
}
