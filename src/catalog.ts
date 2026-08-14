import type { AgentDescriptor, Platform, SkillDelivery } from "./agents.js";

export interface AgentReadableRoot {
  path: string;
  sourceAgent: string;
}

export interface AgentCatalogEntry {
  slug: string;
  displayName: string;
  skillRoots: string[];
  projectSkillsDir?: string;
  command?: string;
  detectionMarkers: string[];
  readableRoots: AgentReadableRoot[];
}

export interface BuiltinAgentCatalogOptions {
  platforms?: Platform[];
  sharedSkillsPath?: string;
}

/**
 * Versioned, provider-neutral skill capability catalog shared by CLI and API consumers.
 * Installation commands and product copy intentionally remain outside the core.
 */
export const BUILTIN_AGENT_CATALOG_VERSION = 1;

const entries: AgentCatalogEntry[] = [
  {
    slug: "adal",
    displayName: "AdaL",
    skillRoots: ["~/.adal/skills"],
    projectSkillsDir: ".adal/skills",
    detectionMarkers: ["~/.adal"],
    readableRoots: [],
  },
  {
    slug: "amp",
    displayName: "Amp",
    skillRoots: ["~/.config/agents/skills"],
    projectSkillsDir: ".agents/skills",
    command: "amp",
    detectionMarkers: ["~/.config/amp"],
    readableRoots: [],
  },
  {
    slug: "antigravity",
    displayName: "Antigravity",
    skillRoots: ["~/.gemini/antigravity/skills"],
    projectSkillsDir: ".agents/skills",
    command: "antigravity",
    detectionMarkers: ["~/.gemini/antigravity"],
    readableRoots: [
      {
        path: "~/.agents/skills",
        sourceAgent: "shared",
      },
    ],
  },
  {
    slug: "antigravity-cli",
    displayName: "Antigravity CLI",
    skillRoots: ["~/.gemini/antigravity-cli/skills"],
    projectSkillsDir: ".agents/skills",
    command: "antigravity",
    detectionMarkers: ["~/.gemini/antigravity-cli"],
    readableRoots: [],
  },
  {
    slug: "augment",
    displayName: "Augment",
    skillRoots: ["~/.augment/skills"],
    projectSkillsDir: ".augment/skills",
    command: "augment",
    detectionMarkers: ["~/.augment"],
    readableRoots: [],
  },
  {
    slug: "bob",
    displayName: "IBM Bob",
    skillRoots: ["~/.bob/skills"],
    projectSkillsDir: ".bob/skills",
    detectionMarkers: ["~/.bob"],
    readableRoots: [],
  },
  {
    slug: "claude-code",
    displayName: "Claude Code",
    skillRoots: ["~/.claude/skills"],
    projectSkillsDir: ".claude/skills",
    command: "claude",
    detectionMarkers: ["~/.claude"],
    readableRoots: [],
  },
  {
    slug: "cline",
    displayName: "Cline",
    skillRoots: ["~/.cline/skills"],
    projectSkillsDir: ".agents/skills",
    command: "cline",
    detectionMarkers: ["~/.cline"],
    readableRoots: [],
  },
  {
    slug: "codebuddy",
    displayName: "CodeBuddy",
    skillRoots: ["~/.codebuddy/skills"],
    projectSkillsDir: ".codebuddy/skills",
    command: "codebuddy",
    detectionMarkers: ["~/.codebuddy"],
    readableRoots: [],
  },
  {
    slug: "codex",
    displayName: "Codex",
    skillRoots: ["~/.codex/skills"],
    projectSkillsDir: ".agents/skills",
    command: "codex",
    detectionMarkers: ["~/.codex"],
    readableRoots: [
      {
        path: "~/.agents/skills",
        sourceAgent: "shared",
      },
    ],
  },
  {
    slug: "command-code",
    displayName: "Command Code",
    skillRoots: ["~/.commandcode/skills"],
    projectSkillsDir: ".commandcode/skills",
    detectionMarkers: ["~/.commandcode"],
    readableRoots: [],
  },
  {
    slug: "continue",
    displayName: "Continue",
    skillRoots: ["~/.continue/skills"],
    projectSkillsDir: ".continue/skills",
    command: "continue",
    detectionMarkers: ["~/.continue"],
    readableRoots: [],
  },
  {
    slug: "copilot-cli",
    displayName: "GitHub Copilot CLI",
    skillRoots: ["~/.copilot/skills"],
    projectSkillsDir: ".agents/skills",
    command: "copilot",
    detectionMarkers: ["~/.copilot"],
    readableRoots: [
      {
        path: "~/.claude/skills",
        sourceAgent: "claude-code",
      },
    ],
  },
  {
    slug: "cortex",
    displayName: "Cortex Code",
    skillRoots: ["~/.snowflake/cortex/skills"],
    projectSkillsDir: ".cortex/skills",
    detectionMarkers: ["~/.snowflake/cortex"],
    readableRoots: [],
  },
  {
    slug: "crush",
    displayName: "Crush",
    skillRoots: ["~/.config/crush/skills"],
    projectSkillsDir: ".crush/skills",
    command: "crush",
    detectionMarkers: ["~/.config/crush"],
    readableRoots: [],
  },
  {
    slug: "cursor",
    displayName: "Cursor",
    skillRoots: ["~/.cursor/skills"],
    projectSkillsDir: ".agents/skills",
    command: "agent",
    detectionMarkers: ["~/.cursor"],
    readableRoots: [
      {
        path: "~/.claude/skills",
        sourceAgent: "claude-code",
      },
    ],
  },
  {
    slug: "deepagents",
    displayName: "Deep Agents",
    skillRoots: ["~/.deepagents/agent/skills"],
    projectSkillsDir: ".agents/skills",
    detectionMarkers: ["~/.deepagents"],
    readableRoots: [],
  },
  {
    slug: "dexto",
    displayName: "Dexto",
    skillRoots: ["~/.config/agents/skills"],
    projectSkillsDir: ".agents/skills",
    command: "dexto",
    detectionMarkers: ["~/.dexto"],
    readableRoots: [],
  },
  {
    slug: "factory",
    displayName: "Factory",
    skillRoots: ["~/.factory/skills"],
    projectSkillsDir: ".factory/skills",
    command: "droid",
    detectionMarkers: ["~/.factory"],
    readableRoots: [],
  },
  {
    slug: "firebender",
    displayName: "Firebender",
    skillRoots: ["~/.firebender/skills"],
    projectSkillsDir: ".agents/skills",
    detectionMarkers: ["~/.firebender"],
    readableRoots: [],
  },
  {
    slug: "gemini-cli",
    displayName: "Gemini",
    skillRoots: ["~/.gemini/skills"],
    projectSkillsDir: ".agents/skills",
    command: "gemini",
    detectionMarkers: ["~/.gemini"],
    readableRoots: [
      {
        path: "~/.agents/skills",
        sourceAgent: "shared",
      },
    ],
  },
  {
    slug: "goose",
    displayName: "Goose",
    skillRoots: ["~/.config/goose/skills"],
    projectSkillsDir: ".goose/skills",
    command: "goose",
    detectionMarkers: ["~/.config/goose"],
    readableRoots: [],
  },
  {
    slug: "iflow-cli",
    displayName: "iFlow CLI",
    skillRoots: ["~/.iflow/skills"],
    projectSkillsDir: ".iflow/skills",
    command: "iflow",
    detectionMarkers: ["~/.iflow"],
    readableRoots: [],
  },
  {
    slug: "junie",
    displayName: "Junie",
    skillRoots: ["~/.junie/skills"],
    projectSkillsDir: ".junie/skills",
    detectionMarkers: ["~/.junie"],
    readableRoots: [],
  },
  {
    slug: "kilo",
    displayName: "Kilo Code",
    skillRoots: ["~/.kilocode/skills"],
    projectSkillsDir: ".kilocode/skills",
    detectionMarkers: ["~/.kilocode"],
    readableRoots: [],
  },
  {
    slug: "kimi-cli",
    displayName: "Kimi Code CLI",
    skillRoots: ["~/.config/agents/skills"],
    projectSkillsDir: ".agents/skills",
    command: "kimi",
    detectionMarkers: ["~/.kimi"],
    readableRoots: [],
  },
  {
    slug: "kiro",
    displayName: "Kiro",
    skillRoots: ["~/.kiro/skills"],
    projectSkillsDir: ".kiro/skills",
    command: "kiro-cli",
    detectionMarkers: ["~/.kiro"],
    readableRoots: [],
  },
  {
    slug: "kode",
    displayName: "Kode",
    skillRoots: ["~/.kode/skills"],
    projectSkillsDir: ".kode/skills",
    command: "kode",
    detectionMarkers: ["~/.kode"],
    readableRoots: [],
  },
  {
    slug: "loaf",
    displayName: "Loaf",
    skillRoots: ["~/.config/loaf/skills"],
    projectSkillsDir: ".agents/skills",
    command: "loaf",
    detectionMarkers: ["~/.config/loaf"],
    readableRoots: [],
  },
  {
    slug: "mcpjam",
    displayName: "MCPJam",
    skillRoots: ["~/.mcpjam/skills"],
    projectSkillsDir: ".mcpjam/skills",
    detectionMarkers: ["~/.mcpjam"],
    readableRoots: [],
  },
  {
    slug: "mistral-vibe",
    displayName: "Mistral Vibe",
    skillRoots: ["~/.vibe/skills"],
    projectSkillsDir: ".vibe/skills",
    detectionMarkers: ["~/.vibe"],
    readableRoots: [],
  },
  {
    slug: "mux",
    displayName: "Mux",
    skillRoots: ["~/.mux/skills"],
    projectSkillsDir: ".mux/skills",
    detectionMarkers: ["~/.mux"],
    readableRoots: [],
  },
  {
    slug: "neovate",
    displayName: "Neovate",
    skillRoots: ["~/.neovate/skills"],
    projectSkillsDir: ".neovate/skills",
    detectionMarkers: ["~/.neovate"],
    readableRoots: [],
  },
  {
    slug: "openclaw",
    displayName: "OpenClaw",
    skillRoots: ["~/.openclaw/skills"],
    projectSkillsDir: "skills",
    command: "openclaw",
    detectionMarkers: ["~/.openclaw"],
    readableRoots: [],
  },
  {
    slug: "opencode",
    displayName: "OpenCode",
    skillRoots: ["~/.config/opencode/skills"],
    projectSkillsDir: ".agents/skills",
    command: "opencode",
    detectionMarkers: ["~/.config/opencode"],
    readableRoots: [
      {
        path: "~/.claude/skills",
        sourceAgent: "claude-code",
      },
      {
        path: "~/.agents/skills",
        sourceAgent: "shared",
      },
    ],
  },
  {
    slug: "openhands",
    displayName: "OpenHands",
    skillRoots: ["~/.openhands/skills"],
    projectSkillsDir: ".openhands/skills",
    command: "openhands",
    detectionMarkers: ["~/.openhands"],
    readableRoots: [],
  },
  {
    slug: "pi",
    displayName: "Pi",
    skillRoots: ["~/.pi/agent/skills"],
    projectSkillsDir: ".pi/skills",
    detectionMarkers: ["~/.pi/agent"],
    readableRoots: [],
  },
  {
    slug: "pochi",
    displayName: "Pochi",
    skillRoots: ["~/.pochi/skills"],
    projectSkillsDir: ".pochi/skills",
    detectionMarkers: ["~/.pochi"],
    readableRoots: [],
  },
  {
    slug: "promptscript",
    displayName: "PromptScript",
    skillRoots: ["~/.config/agents/skills"],
    projectSkillsDir: ".agents/skills",
    command: "promptscript",
    detectionMarkers: ["~/.promptscript"],
    readableRoots: [],
  },
  {
    slug: "qoder",
    displayName: "Qoder",
    skillRoots: ["~/.qoder/skills"],
    projectSkillsDir: ".qoder/skills",
    command: "qodercli",
    detectionMarkers: ["~/.qoder"],
    readableRoots: [],
  },
  {
    slug: "qwen-code",
    displayName: "Qwen Code",
    skillRoots: ["~/.qwen/skills"],
    projectSkillsDir: ".qwen/skills",
    command: "qwen",
    detectionMarkers: ["~/.qwen"],
    readableRoots: [],
  },
  {
    slug: "replit",
    displayName: "Replit",
    skillRoots: ["~/.config/agents/skills"],
    projectSkillsDir: ".agents/skills",
    detectionMarkers: [".replit"],
    readableRoots: [],
  },
  {
    slug: "roo",
    displayName: "Roo Code",
    skillRoots: ["~/.roo/skills"],
    projectSkillsDir: ".roo/skills",
    detectionMarkers: ["~/.roo"],
    readableRoots: [],
  },
  {
    slug: "trae",
    displayName: "Trae",
    skillRoots: ["~/.trae/skills"],
    projectSkillsDir: ".trae/skills",
    command: "trae",
    detectionMarkers: ["~/.trae"],
    readableRoots: [],
  },
  {
    slug: "trae-cn",
    displayName: "Trae CN",
    skillRoots: ["~/.trae-cn/skills"],
    projectSkillsDir: ".trae/skills",
    detectionMarkers: ["~/.trae-cn"],
    readableRoots: [],
  },
  {
    slug: "warp",
    displayName: "Warp",
    skillRoots: ["~/.warp/skills"],
    projectSkillsDir: ".agents/skills",
    detectionMarkers: ["/Applications/Warp.app", "~/AppData/Roaming/warp/Warp", "~/.local/share/warp-terminal"],
    readableRoots: [
      {
        path: "~/.agents/skills",
        sourceAgent: "shared",
      },
      {
        path: "~/.claude/skills",
        sourceAgent: "claude-code",
      },
      {
        path: "~/.codex/skills",
        sourceAgent: "codex",
      },
      {
        path: "~/.cursor/skills",
        sourceAgent: "cursor",
      },
      {
        path: "~/.gemini/skills",
        sourceAgent: "gemini-cli",
      },
      {
        path: "~/.copilot/skills",
        sourceAgent: "copilot-cli",
      },
      {
        path: "~/.factory/skills",
        sourceAgent: "factory",
      },
      {
        path: "~/.opencode/skills",
        sourceAgent: "opencode",
      },
    ],
  },
  {
    slug: "windsurf",
    displayName: "Windsurf",
    skillRoots: ["~/.codeium/windsurf/skills"],
    projectSkillsDir: ".windsurf/skills",
    command: "windsurf",
    detectionMarkers: ["~/.codeium/windsurf"],
    readableRoots: [],
  },
  {
    slug: "zed",
    displayName: "Zed",
    skillRoots: ["~/.config/zed/skills"],
    projectSkillsDir: ".agents/skills",
    detectionMarkers: ["/Applications/Zed.app", "~/.config/zed", "~/.var/app/dev.zed.Zed/config/zed"],
    readableRoots: [],
  },
  {
    slug: "zencoder",
    displayName: "Zencoder",
    skillRoots: ["~/.zencoder/skills"],
    projectSkillsDir: ".zencoder/skills",
    detectionMarkers: ["~/.zencoder"],
    readableRoots: [],
  },
];

function cloneEntry(entry: AgentCatalogEntry): AgentCatalogEntry {
  return {
    ...entry,
    skillRoots: [...entry.skillRoots],
    detectionMarkers: [...entry.detectionMarkers],
    readableRoots: entry.readableRoots.map((root) => ({ ...root })),
  };
}

/** Returns defensive copies so consumers cannot mutate the process-wide catalog. */
export function builtinAgentCatalog(): AgentCatalogEntry[] {
  return entries.map(cloneEntry);
}

export function builtinAgentCatalogEntry(slug: string): AgentCatalogEntry | null {
  const entry = entries.find((candidate) => candidate.slug === slug);
  return entry ? cloneEntry(entry) : null;
}

export function agentCatalogEntryToDescriptor(
  entry: AgentCatalogEntry,
  options: BuiltinAgentCatalogOptions = {},
): AgentDescriptor {
  const sharedSkillsPath = options.sharedSkillsPath ?? "~/.agents/skills";
  const readsShared = entry.readableRoots.some(
    (root) => root.sourceAgent === "shared" || root.path === sharedSkillsPath,
  );
  const skills: SkillDelivery[] = [
    ...(readsShared ? [{ kind: "native-shared" as const }] : []),
    ...(entry.skillRoots.length > 0 ? [{ kind: "per-skill-link" as const, roots: [...entry.skillRoots] }] : []),
  ];
  if (skills.length === 0) {
    throw new Error(`Agent ${entry.slug} has no verified skill delivery capability`);
  }
  return {
    slug: entry.slug,
    displayName: entry.displayName,
    platforms: options.platforms ?? ["darwin", "linux", "win32"],
    detection: [
      ...(entry.command ? [{ kind: "command" as const, command: entry.command }] : []),
      ...entry.detectionMarkers.map((marker) => ({
        kind: "marker" as const,
        path: marker,
        ignoreSkillsOnly: true,
      })),
    ],
    skills,
  };
}

export function builtinAgentDescriptors(options: BuiltinAgentCatalogOptions = {}): AgentDescriptor[] {
  return entries.map((entry) => agentCatalogEntryToDescriptor(entry, options));
}
