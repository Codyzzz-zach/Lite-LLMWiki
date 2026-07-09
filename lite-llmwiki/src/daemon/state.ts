import { join } from "node:path";
/**
 * state — daemon 状态管理（原子写入）
 *
 * 设计决策（架构设计 §14 §17#2）：
 * - 无独立 PID 文件——daemon-state.json 含 pid + lastHeartbeat
 * - 原子写入（write-to-temp + rename）防止与 CLI 冲突
 * - daemon 是状态文件主写入方
 */

import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

export interface DaemonState {
	pid: number;
	startedAt: string;
	lastHeartbeat: string;
	stats: {
		propsExtracted: number;
		auditsRun: number;
		lintsRun: number;
		reflowsScreened: number;
	};
	queue: {
		pendingPropExtraction: string[];
		pendingAudit: string[];
	};
}

export function createDaemonState(): DaemonState {
	return {
		pid: process.pid,
		startedAt: new Date().toISOString(),
		lastHeartbeat: new Date().toISOString(),
		stats: {
			propsExtracted: 0,
			auditsRun: 0,
			lintsRun: 0,
			reflowsScreened: 0,
		},
		queue: {
			pendingPropExtraction: [],
			pendingAudit: [],
		},
	};
}

/** 原子写入——先写临时文件，再 rename */
export function writeDaemonState(
	projectRoot: string,
	state: DaemonState,
): void {
	state.lastHeartbeat = new Date().toISOString();
	const dir = join(projectRoot, "loopadvance");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const destPath = join(dir, "daemon-state.json");
	const tmpPath = join(tmpdir(), `daemon-state-${randomUUID()}.json`);

	writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
	renameSync(tmpPath, destPath);
}

/** 读取 daemon 状态 */
export function readDaemonState(projectRoot: string): DaemonState | null {
	const path = join(projectRoot, "loopadvance", "daemon-state.json");
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as DaemonState;
	} catch {
		return null;
	}
}

/** 检查 daemon 是否存活（lastHeartbeat 在 60s 内） */
export function isDaemonAlive(state: DaemonState): boolean {
	const heartbeat = new Date(state.lastHeartbeat).getTime();
	return Date.now() - heartbeat < 60_000;
}
