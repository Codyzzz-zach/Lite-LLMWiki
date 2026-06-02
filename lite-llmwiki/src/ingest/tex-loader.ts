import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
- \\begin{theorem}...\\end{theorem}、\\begin{lemma}...、\\begin{proof}... → > **Theorem/Lemma/Proof:** ...
- \\thanks{...} → 在处理作者信息时保留，用 _[...]_ 上标注，不混入正文
- \\begin{itemize}...\\item... → - 列表
- \\begin{enumerate}...\\item... → 1. 列表
- 去掉 \\begin{figure}、\\begin{table}、\\begin{algorithm} 等浮动环境，
  保留其中的 \\caption 文字作为 > Quote
- 去掉 preamble（\\documentclass、\\usepackage 等），但保留 \\title 和 \\author
- 参考文献存在则保留为 ## References 节
- 只输出 Markdown，不要解释`;

const MAX_RECURSION_DEPTH = 10;

/** 解析 \input{xxx} 和 \include{xxx}，把子文件内容拼接到主文件中 */
function resolveTexIncludes(
  content: string,
  baseDir: string,
  visited = new Set<string>(),
  depth = 0,
): string {
  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(`TeX \`\\input{} 递归深度超过 ${MAX_RECURSION_DEPTH} 层，可能是循环引用`);
  }

  return content.replace(/\\(?:input|include)\{(.+?)\}/g, (_, name: string) => {
    const cleanName = name.trim();
    const key = join(baseDir, cleanName);
    if (visited.has(key)) return `% already included: ${cleanName}`;
    visited.add(key);

    // 尝试 .tex 和 无扩展名
    for (const ext of [".tex", ""]) {
      const fullPath = join(baseDir, `${cleanName}${ext}`);
      if (existsSync(fullPath)) {
        const child = readFileSync(fullPath, "utf-8");
        return resolveTexIncludes(child, baseDir, visited, depth + 1);
      }
    }

    // 没找到 → warn 并在清洗后文中留下标记
    console.warn(`  [TeX] ⚠️  missing: ${cleanName}（未找到子文件，对应内容已跳过）`);
    return `% [Missing: ${cleanName}]`;
  });
}

/** 处理 \bibliography{xxx} → 模糊匹配同目录下的 .bbl 文件 */
function resolveBbl(rawTex: string, baseDir: string): string {
  return rawTex.replace(/\\(?:bibliography)\{(.+?)\}/g, (_, name: string) => {
    const cleanName = name.trim();
    // 精确匹配
    for (const ext of [".bbl", ""]) {
      const exact = join(baseDir, `${cleanName}${ext}`);
      if (existsSync(exact)) {
        const bbl = readFileSync(exact, "utf-8");
        return bbl;
      }
    }
    // 模糊匹配：找同目录下任意 .bbl
    try {
      const files = readdirSync(baseDir).filter((f) => f.endsWith(".bbl"));
      if (files.length > 0) {
        const fallback = readFileSync(join(baseDir, files[0]!), "utf-8");
        console.warn(`  [TeX] ⚠️  \`\\bibliography{${cleanName}} 未找到，使用 ${files[0]} 替代`);
        return fallback;
      }
    } catch { /* dir not accessible */ }

    console.warn(`  [TeX] ⚠️  未找到 .bbl 文件，参考文献将缺失`);
    return `% [Missing bibliography: ${cleanName}]`;
  });
}

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

  const texDir = dirname(filePath);
  const bblResolved = resolveBbl(rawTex, texDir);
  const resolvedTex = resolveTexIncludes(bblResolved, texDir);

  // 从原始 TeX 提取 \title{}，支持多行
  const titleMatch = rawTex.match(/\\title\{([\s\S]*?)\}/);
  const texTitle = titleMatch
    ? titleMatch[1]!.replace(/\s*\\\\\s*/g, " ").replace(/\s+/g, " ").trim()
    : "";

  // 清洗前估算 token 量，长文档提示用户
  const estTokens = estimateTokens(resolvedTex);
  if (estTokens > 50000) {
    console.warn(`  [TeX] ⚠️  论文较长（~${(estTokens / 1000).toFixed(0)}K tokens），清洗可能较慢`);
  }

  let body: string;
  let title = texTitle || name;

  if (config?.apiKey) {
    console.error("  [TeX] cleaning with DeepSeek...");
    const client = new DeepSeekClient(config);
    try {
      const result = await client.chat({
        model: config.model,
        systemPrompt: TEX_CLEAN_PROMPT,
        messages: [{ role: "user", content: resolvedTex }],
        responseFormat: "text",
        maxTokens: 32768,
      });
      body = result.content.trim();
      const h1Match = body.match(/^#\s+(.+)/m);
      if (h1Match) title = h1Match[1]!.trim();
    } catch (err) {
      console.error(`  [TeX] cleaning failed, falling back to raw .tex: ${(err as Error).message}`);
      body = resolvedTex;
    }
  } else {
    console.error("  [TeX] no API key, using raw .tex");
    body = resolvedTex;
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
    sourceRoot: texDir,
    type: "tex",
    title,
    meta: { format: "tex" },
    body,
    chunks,
    totalTokens: estimateTokens(body),
    createdAt: new Date(),
    fingerprint,
  };
}
