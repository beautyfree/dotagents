export type Platform = "darwin" | "linux" | "win32";

export type DetectionRule =
  | { kind: "command"; command: string }
  | { kind: "marker"; path: string; ignoreSkillsOnly?: boolean };

export type SkillDelivery =
  | { kind: "native-shared" }
  | { kind: "per-skill-link"; roots: string[] }
  | { kind: "copy-only"; roots: string[] };

export interface AgentDescriptor {
  slug: string;
  displayName: string;
  platforms: Platform[];
  detection: DetectionRule[];
  skills: SkillDelivery[];
}

export function validateAgentDescriptor(descriptor: AgentDescriptor): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(descriptor.slug)) throw new Error(`Invalid agent slug: ${descriptor.slug}`);
  if (!descriptor.displayName.trim()) throw new Error(`Agent ${descriptor.slug} has no display name`);
  if (descriptor.platforms.length === 0) throw new Error(`Agent ${descriptor.slug} has no supported platform`);
  if (descriptor.skills.length === 0) throw new Error(`Agent ${descriptor.slug} has no skill delivery capability`);
  for (const rule of descriptor.detection) {
    const value = rule.kind === "command" ? rule.command : rule.path;
    if (!value.trim() || /[\r\n\0]/.test(value))
      throw new Error(`Agent ${descriptor.slug} has an invalid detection rule`);
  }
  for (const delivery of descriptor.skills) {
    if (delivery.kind === "native-shared") continue;
    if (delivery.roots.length === 0 || delivery.roots.some((root) => !root.trim() || /[\r\n\0]/.test(root))) {
      throw new Error(`Agent ${descriptor.slug} has an invalid ${delivery.kind} root`);
    }
  }
}
