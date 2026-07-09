import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { DeepSeekClient } from "../../core/client.js";
import { proIngest } from "../../ingest/listening.js";
import { loadFromFile } from "../../ingest/loader.js";
import { loadFromPdf } from "../../ingest/pdf-loader.js";
import { loadFromTex } from "../../ingest/tex-loader.js";

/** 扫描 TeX 文件夹，找包含 \documentclass 的主 .tex 文件 */
function findMainTex(dir: string): string {
	if (!existsSync(dir)) throw new Error(`Directory not found: ${dir}`);
	const files = readdirSync(dir).filter((f) => f.endsWith(".tex"));
	if (files.length === 0) throw new Error(`No .tex files found in ${dir}`);
	for (const f of files) {
		const content = readFileSync(join(dir, f), "utf-8");
		if (content.includes("\\documentclass")) return join(dir, f);
	}
	let largest = files[0]!;
	for (const f of files) {
		if (statSync(join(dir, f)).size > statSync(join(dir, largest)).size)
			largest = f;
	}
	return join(dir, largest);
}

export function registerPlanCommand(program: Command): void {
	program
		.command("plan")
		.description(
			"Extract propositions and coverage from a source — dry-run, no wiki writes",
		)
		.argument(
			"<path>",
			"path to .md / .tex / .pdf file, or a TeX project folder",
		)
		.option("-j, --json", "output raw JSON (default: pretty-printed)", false)
		.action(async (path: string, opts: { json: boolean }) => {
			await runPlan({ file: path, json: opts.json });
		});
}

interface PlanOptions {
	file: string;
	json: boolean;
}

async function runPlan(opts: PlanOptions): Promise<void> {
	const config = loadConfig();
	if (!config.apiKey) {
		const err = { ok: false, error: "DEEPSEEK_API_KEY not set" };
		console.log(opts.json ? JSON.stringify(err) : `  ❌  ${err.error}`);
		process.exit(1);
	}

	// ——— 加载（单文件 / TeX 文件夹）
	let sourcePath = opts.file;
	const ext = extname(opts.file).toLowerCase();
	let stat: ReturnType<typeof statSync> | undefined;
	try {
		stat = statSync(opts.file);
	} catch {
		/* not found */
	}

	if (stat?.isDirectory()) {
		sourcePath = findMainTex(opts.file);
	}

	let source;
	try {
		source =
			stat?.isDirectory() || ext === ".tex"
				? await loadFromTex(sourcePath, config, {
						chunkTokenTarget: config.chunkTokenTarget,
						chunkOverlapTokens: config.chunkOverlapTokens,
					})
				: ext === ".pdf"
					? await loadFromPdf(opts.file, {
							chunkTokenTarget: config.chunkTokenTarget,
							chunkOverlapTokens: config.chunkOverlapTokens,
							config,
						})
					: loadFromFile(opts.file, {
							chunkTokenTarget: config.chunkTokenTarget,
							chunkOverlapTokens: config.chunkOverlapTokens,
						});
	} catch (err) {
		const result = {
			ok: false,
			error: `Failed to load source: ${(err as Error).message}`,
		};
		console.log(opts.json ? JSON.stringify(result) : `  ❌  ${result.error}`);
		process.exit(1);
	}

	const client = new DeepSeekClient(config);

	// ——— Extract: 只读不写 ———
	let br;
	try {
		br = await proIngest({ source, config, client, mode: "extract" });
	} catch (err) {
		const result = {
			ok: false,
			error: `Extract failed: ${(err as Error).message}`,
		};
		console.log(opts.json ? JSON.stringify(result) : `  ❌  ${result.error}`);
		process.exit(1);
	}

	const threads = br.mainThreads ?? [];
	const propositions = br.propositions ?? [];

	// 统计 chunk coverage（每个 proposition 涉及的 chunkRefs）
	const coveredChunkSet = new Set<number>();
	for (const p of propositions) {
		for (const ref of p.chunkRefs) coveredChunkSet.add(ref);
	}
	const totalChunks = source.chunks.length;

	const output = {
		ok: true,
		source: {
			id: source.id,
			title: source.title,
			type: source.type,
			chunks: totalChunks,
			tokens: source.totalTokens,
		},
		threads: threads.map((t) => ({
			id: t.id,
			title: t.title,
			description: t.description,
			chunkRefs: t.chunkRefs,
		})),
		propositions: propositions.map((p) => ({
			id: p.id,
			threadId: p.threadId,
			claim: p.claim,
			aiReading: p.aiReading,
			chunkRefs: p.chunkRefs,
			kind: p.kind ?? null,
			confidence: p.confidence ?? null,
			evidence: p.evidence ?? null,
			counterIntuitive: p.counterIntuitive ?? false,
			counterIntuitiveReason: p.counterIntuitiveReason ?? null,
			coverage: p.coverage ?? null,
		})),
		coverage: {
			coveredChunks: coveredChunkSet.size,
			totalChunks,
			uncoveredChunks: totalChunks - coveredChunkSet.size,
		},
	};

	if (opts.json) {
		console.log(JSON.stringify(output, null, 2));
	} else {
		console.log(`\n  📋  Plan for: ${source.title}`);
		console.log(
			`      type: ${source.type}  |  chunks: ${totalChunks}  |  tokens: ~${source.totalTokens}\n`,
		);
		console.log(`  📌  ${threads.length} main threads`);
		for (const t of threads) {
			console.log(`      [${t.id}] ${t.title} — ${t.description}`);
		}
		console.log(`\n  📄  ${propositions.length} propositions`);
		for (const p of propositions) {
			const kind = p.kind ? ` (${p.kind})` : "";
			const conf = p.confidence ? ` [${(p.confidence * 100).toFixed(0)}%]` : "";
			console.log(`      [${p.id}]${kind}${conf} ${p.claim.slice(0, 80)}`);
		}
		console.log(
			`\n  📊  Coverage: ${coveredChunkSet.size}/${totalChunks} chunks covered`,
		);
		if (totalChunks - coveredChunkSet.size > 0) {
			const uncovered = source.chunks
				.filter((c) => !coveredChunkSet.has(c.index))
				.map((c) => `chunk ${c.index}`);
			console.log(`      Uncovered: ${uncovered.join(", ")}`);
		}
		console.log(`\n  💡  No wiki files written (dry-run)\n`);
	}
}
