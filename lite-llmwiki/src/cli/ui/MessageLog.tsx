import { Box, Text } from "ink";
import type React from "react";

export type MessageKind =
	| "user"
	| "system"
	| "ai"
	| "divider"
	| "result"
	| "error"
	| "warning";

export interface ChatMessage {
	kind: MessageKind;
	content: string;
	sources?: string[];
	timestamp?: Date;
}

function msgColor(kind: MessageKind): string {
	switch (kind) {
		case "user":
			return "cyan";
		case "system":
			return "gray";
		case "ai":
			return "white";
		case "result":
			return "green";
		case "error":
			return "red";
		case "warning":
			return "yellow";
		case "divider":
			return "gray";
	}
}

function msgPrefix(kind: MessageKind): string {
	switch (kind) {
		case "user":
			return " ❯";
		case "system":
			return "";
		case "ai":
			return " 💡";
		case "result":
			return " ✅";
		case "error":
			return " ❌";
		case "warning":
			return " ⚠️";
		case "divider":
			return " ─";
	}
}

/** 消息日志 */
export function MessageLog({
	messages,
	children,
}: {
	messages: ChatMessage[];
	children?: React.ReactNode;
}) {
	return (
		<Box flexDirection="column" flexGrow={1}>
			{messages.map((m, i) => (
				<Box key={i} flexDirection="column">
					<Box>
						<Text color={msgColor(m.kind)} dimColor={m.kind === "divider"}>
							{msgPrefix(m.kind)} {m.content}
						</Text>
					</Box>
					{m.sources && m.sources.length > 0 && (
						<Box marginLeft={3}>
							<Text color="gray" dimColor>
								(来源: {m.sources.join(", ")})
							</Text>
						</Box>
					)}
				</Box>
			))}
			{children && <Box marginTop={1}>{children}</Box>}
		</Box>
	);
}
