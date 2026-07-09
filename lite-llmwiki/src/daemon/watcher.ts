/**
 * watcher — 文件监听（chokidar）
 *
 * 监听 chase/ 和 wiki/ 目录：
 * - chase 新文件 → 触发命题提取
 * - wiki 变化 → 触发 audit
 */

import { join } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { AppConfig } from "../types.js";

export interface WatcherCallbacks {
	onNewChase: (chasePath: string) => void;
	onWikiChange: (wikiPath: string) => void;
}

/** 启动文件监听，返回 watcher 实例 */
export function startWatcher(
	config: AppConfig,
	callbacks: WatcherCallbacks,
): FSWatcher {
	const chaseDir = join(config.rawDir, "chase");
	const wikiDir = config.wikiDir;

	const watcher = watch([chaseDir, wikiDir], {
		ignored: /(^|[\/\\])\../, // 忽略隐藏文件
		persistent: true,
		ignoreInitial: true, // 不触发已有文件
		awaitWriteFinish: {
			stabilityThreshold: 500,
			pollInterval: 100,
		},
	});

	watcher.on("add", (filePath: string) => {
		if (filePath.startsWith(chaseDir) && filePath.endsWith(".md")) {
			callbacks.onNewChase(filePath);
		}
	});

	watcher.on("change", (filePath: string) => {
		if (filePath.startsWith(wikiDir) && filePath.endsWith(".md")) {
			callbacks.onWikiChange(filePath);
		}
	});

	return watcher;
}

/** 停止文件监听 */
export function stopWatcher(watcher: FSWatcher): Promise<void> {
	return watcher.close();
}
