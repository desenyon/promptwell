import type { InstructionFileId, PlatformId, ToolId } from "@/types";

export interface CatalogOption<T extends string> {
  id: T;
  label: string;
  description: string;
}

export const PLATFORM_OPTIONS: CatalogOption<PlatformId>[] = [
  {
    id: "cursor",
    label: "Cursor",
    description: "Rules, skills, MCP, and agent workflows",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "CLAUDE.md, skills, hooks, and subagents",
  },
  {
    id: "codex",
    label: "Codex CLI",
    description: "AGENTS.md, skills, MCP, and automations",
  },
  {
    id: "generic",
    label: "Chat or API",
    description: "Portable prompts without coding-agent assumptions",
  },
];

export const TOOL_OPTIONS: CatalogOption<ToolId>[] = [
  {
    id: "graphify",
    label: "Graphify",
    description: "Queryable codebase knowledge graphs before blind search",
  },
  {
    id: "context7",
    label: "Context7",
    description: "Current, version-specific library documentation",
  },
  {
    id: "headroom",
    label: "Headroom",
    description: "Compress noisy context and retrieve originals on demand",
  },
  {
    id: "web-search",
    label: "Web search",
    description: "Current external research and primary sources",
  },
  {
    id: "mcp",
    label: "MCP servers",
    description: "Live systems, databases, issue trackers, and custom tools",
  },
  {
    id: "skills",
    label: "Skills",
    description: "Reusable multi-step agent workflows",
  },
  {
    id: "hooks",
    label: "Hooks",
    description: "Deterministic enforcement and lifecycle automation",
  },
  {
    id: "optimization",
    label: "Optimization workflows",
    description: "Measure, baseline, target, and regression-guarded tuning",
  },
];

export const INSTRUCTION_OPTIONS: CatalogOption<InstructionFileId>[] = [
  {
    id: "agents-md",
    label: "AGENTS.md",
    description: "Cross-tool repository instructions",
  },
  {
    id: "claude-md",
    label: "CLAUDE.md",
    description: "Claude-specific project memory",
  },
  {
    id: "cursor-rules",
    label: "Cursor rules",
    description: "Scoped .cursor/rules/*.mdc guidance",
  },
];

export const PLATFORM_IDS = PLATFORM_OPTIONS.map((option) => option.id);
export const TOOL_IDS = TOOL_OPTIONS.map((option) => option.id);
export const INSTRUCTION_FILE_IDS = INSTRUCTION_OPTIONS.map((option) => option.id);

export const PLATFORM_LABELS = Object.fromEntries(
  PLATFORM_OPTIONS.map((option) => [option.id, option.label]),
) as Record<PlatformId, string>;

export const TOOL_LABELS = Object.fromEntries(
  TOOL_OPTIONS.map((option) => [option.id, option.label]),
) as Record<ToolId, string>;

export const INSTRUCTION_LABELS = Object.fromEntries(
  INSTRUCTION_OPTIONS.map((option) => [option.id, option.label]),
) as Record<InstructionFileId, string>;
