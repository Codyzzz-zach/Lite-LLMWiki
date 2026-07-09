/**
 * timer — 定时器（setInterval）
 *
 * 定期执行：
 * - lint（每 30 分钟）
 * - heartbeat 更新（每 30 秒）
 * - 回流候选筛选（每 60 分钟）
 */

export interface TimerCallbacks {
	onLint: () => void;
	onHeartbeat: () => void;
	onReflowScreen: () => void;
}

export interface TimerHandles {
	lint: ReturnType<typeof setInterval>;
	heartbeat: ReturnType<typeof setInterval>;
	reflow: ReturnType<typeof setInterval>;
}

const LINT_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 sec
const REFLOW_INTERVAL_MS = 60 * 60 * 1000; // 60 min

/** 启动所有定时器 */
export function startTimers(callbacks: TimerCallbacks): TimerHandles {
	// 启动后立即跑一次 lint
	callbacks.onLint();
	callbacks.onHeartbeat();

	return {
		lint: setInterval(callbacks.onLint, LINT_INTERVAL_MS),
		heartbeat: setInterval(callbacks.onHeartbeat, HEARTBEAT_INTERVAL_MS),
		reflow: setInterval(callbacks.onReflowScreen, REFLOW_INTERVAL_MS),
	};
}

/** 停止所有定时器 */
export function stopTimers(handles: TimerHandles): void {
	clearInterval(handles.lint);
	clearInterval(handles.heartbeat);
	clearInterval(handles.reflow);
}
