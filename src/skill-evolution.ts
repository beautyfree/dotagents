import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

export type SkillImprovementNote = {
  id: string;
  created_at: string;
  prompt: string;
  actual: string;
  expected: string;
};

function assertSkillId(skill: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) throw new Error(`Invalid skill identifier: ${skill}`);
}

/** Device-local, deliberately untracked workspace for a person's improvement notes. */
export function skillEvolutionDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const configHome =
    environment.DOTAGENTS_CONFIG_HOME ??
    environment.XDG_CONFIG_HOME ??
    (platform === "win32"
      ? (environment.APPDATA ?? paths.join(home, "AppData", "Roaming"))
      : platform === "darwin"
        ? paths.join(home, "Library", "Application Support")
        : paths.join(home, ".config"));
  return paths.join(configHome, "dotagents", "skill-evolution");
}

export function skillEvolutionPath(skill: string, directory = skillEvolutionDirectory()): string {
  assertSkillId(skill);
  return path.join(directory, `${skill}.json`);
}

/** A private workspace whose eval cases use Skiller's existing evals/cases contract. */
export function privateEvaluationWorkspace(skill: string, directory = skillEvolutionDirectory()): string {
  assertSkillId(skill);
  return path.join(directory, skill, "evals", "cases");
}

function writeAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, file);
}

function parseNotes(value: unknown): SkillImprovementNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const note = entry as Partial<SkillImprovementNote>;
    if (typeof note.id !== "string" || typeof note.created_at !== "string" || Number.isNaN(Date.parse(note.created_at)))
      return [];
    if (typeof note.prompt !== "string" || typeof note.actual !== "string" || typeof note.expected !== "string")
      return [];
    return [
      { id: note.id, created_at: note.created_at, prompt: note.prompt, actual: note.actual, expected: note.expected },
    ];
  });
}

export function readSkillImprovementNotes(
  skill: string,
  directory = skillEvolutionDirectory(),
): SkillImprovementNote[] {
  const file = skillEvolutionPath(skill, directory);
  if (!existsSync(file)) return [];
  try {
    return parseNotes(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return [];
  }
}

export function addSkillImprovementNote(
  skill: string,
  input: Pick<SkillImprovementNote, "prompt" | "actual" | "expected">,
  directory = skillEvolutionDirectory(),
): SkillImprovementNote {
  assertSkillId(skill);
  for (const [field, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 20_000) {
      throw new Error(`Invalid ${field}`);
    }
  }
  const note: SkillImprovementNote = { id: randomUUID(), created_at: new Date().toISOString(), ...input };
  const file = skillEvolutionPath(skill, directory);
  writeAtomic(file, `${JSON.stringify([...readSkillImprovementNotes(skill, directory), note], null, 2)}\n`);

  // This is intentionally outside the skill root. It can later be copied into
  // evals/cases/ when the owner decides the case is worth publishing.
  const caseFile = path.join(privateEvaluationWorkspace(skill, directory), `observed-${note.id}.yaml`);
  writeAtomic(
    caseFile,
    stringifyYaml({
      behavior: `observed-${note.id}`,
      prompt: note.prompt,
      checks: [{ judge: note.expected }],
    }),
  );
  return note;
}
