import { Box, Text } from "ink";
import React from "react";

export interface Stats {
  sources: number;
  nodes: number;
}

/** 顶部标题栏 + 状态 */
export function StatusLine({ stats }: { stats: Stats }) {
  return (
    <Box>
      <Text bold color="cyan"> 📚 lite-llmwiki</Text>
      <Text>  </Text>
      <Text color="gray">│</Text>
      <Text color="green"> r:{stats.sources}</Text>
      <Text color="yellow"> n:{stats.nodes}</Text>
    </Box>
  );
}
