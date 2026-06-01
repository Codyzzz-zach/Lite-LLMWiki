import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { AppConfig, Source } from "../types.js";
import { DeepSeekClient } from "../core/client.js";
import { chunkText, estimateTokens } from "./loader.js";

const TEX_CLEAN_PROMPT = `你收到的是 LaTeX 论文源文件。请将其转换为清晰可读的 Markdown：
- \\section → ##，\\subsection → ###，\\subsubsection → ####
- \\begin{abstract}...\\end{abstract} → 保留内容，去掉环境标记
- $...$ 和 $$...$$ 原样保留
- \\cite{xxx} → [xxx]
- \\textbf{...} → **...**
- \\textit{...} → *...*
- 去掉 \\begin{figure}、\\begin{table}、\\begin{algorithm} 等浮动环境，
  保留其中的 \\caption 文字作为 > Quote
- 去掉 preamble（\\documentclass、\\usepackage 等）
- 参考文献存在则保留为 ## References 节
- 只输出 Markdown，不要解释`;

export async function loadFromTex(filePath: string, config?: AppConfig, options?: {
  chunkTokenTarget?: number;
  chunkOverlapTokens?: number;
}): Promise<Source> {
  const filename = basename(filePath);
  const name = filename.replace(/\.tex$/i, "");

  const rawTex = readFileSync(filePath, "utf-8");
  if (rawTex.length < 50) {
    throw new Error(`TeX file too short (${rawTex.length} chars)`);
  }

  let body: string;
  let title = name;

  if (config?.apiKey) {
    console.error("  [TeX] cleaning with DeepSeek...");
    const client = new DeepSeekClient(config);
    try {
      const result = await client.chat({
        model: config.model,
        systemPrompt: TEX_CLEAN_PROMPT,
        messages: [{ role: "user", content: rawTex }],
        responseFormat: "text",
        maxTokens: 16384,
      });
      body = result.content.trim();
      const titleMatch = body.match(/^#\s+(.+)/m);
      if (titleMatch) title = titleMatch[1]!.trim();
    } catch (err) {
      console.error(`  [TeX] cleaning failed, using raw: ${(err as Error).message}`);
      body = rawTex;
    }
  } else {
    console.error("  [TeX] no API key, using raw .tex");
    body = rawTex;
  }

  const fingerprint = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const id = `raw/tex/${name}-${fingerprint}`;

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
    type: "md",
    title,
    meta: { format: "tex" },
    body,
    chunks,
    totalTokens: estimateTokens(body),
    createdAt: new Date(),
    fingerprint,
  };
}
