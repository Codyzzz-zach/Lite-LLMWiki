import { Box, Text, useInput } from "ink";
import type { Key } from "ink";
import React, { useCallback, useState } from "react";

export type CommandFn = (
	cmd: string,
	args: string,
	raw: string,
) => void | Promise<void>;

/** 解析冒号命令 */
export function parseCommand(
	raw: string,
): { cmd: string; args: string } | null {
	const s = raw.trim();
	if (!s.startsWith(":")) return null;
	const rest = s.slice(1);
	const space = rest.indexOf(" ");
	if (space < 0) return { cmd: rest, args: "" };
	return {
		cmd: rest.slice(0, space).toLowerCase(),
		args: rest.slice(space + 1).trim(),
	};
}

type InputPhase =
	| "idle"
	| "loaded"
	| "brainstorming"
	| "waiting_focus"
	| "compiling"
	| "done";

export function InputLine({
	onCommand,
	onRawInput,
	busy,
	phase,
}: {
	onCommand: CommandFn;
	onRawInput?: (text: string) => void;
	busy: boolean;
	phase?: InputPhase;
}) {
	const [input, setInput] = useState("");
	const [history, setHistory] = useState<string[]>([]);
	const [histIdx, setHistIdx] = useState(-1);

	useInput(
		useCallback(
			(ch: string, key: Key) => {
				if (key.return && !busy) {
					const raw = input;
					if (!raw.trim()) {
						// 在 waiting_focus 阶段，空回车 = 默认选第一个
						if (phase === "waiting_focus") {
							setInput("");
							onRawInput?.("");
						}
						return;
					}
					setHistory((h) => [raw, ...h].slice(0, 50));
					setHistIdx(-1);
					setInput("");

					if (phase === "waiting_focus") {
						// 直接作为 focus 回应
						onRawInput?.(raw);
						return;
					}

					const parsed = parseCommand(raw);
					if (parsed) {
						onCommand(parsed.cmd, parsed.args, raw);
					} else {
						onCommand("query", raw, raw);
					}
					return;
				}

				if (key.upArrow && !busy && history.length > 0) {
					const next = Math.min(histIdx + 1, history.length - 1);
					setHistIdx(next);
					setInput(history[next]!);
					return;
				}
				if (key.downArrow && !busy) {
					if (histIdx > 0) {
						setHistIdx(histIdx - 1);
						setInput(history[histIdx - 1]!);
					} else {
						setHistIdx(-1);
						setInput("");
					}
					return;
				}

				if (!busy && key.backspace) {
					setInput((s) => s.slice(0, -1));
					return;
				}

				if (!busy && ch) {
					setInput((s) => s + ch);
				}
			},
			[input, history, histIdx, busy, onCommand, onRawInput, phase],
		),
	);

	// 动态提示文字
	const promptLabel = phase === "waiting_focus" ? "✏️" : "❯";
	const promptHint =
		phase === "waiting_focus" ? " 输入你的关注方向 (回车直接选 [1])" : "";

	return (
		<Box>
			<Text bold color="cyan">
				{promptLabel}{" "}
			</Text>
			<Text>{input || ""}</Text>
			{!input && <Text color="gray">{promptHint}</Text>}
		</Box>
	);
}
