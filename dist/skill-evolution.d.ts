export type SkillImprovementNote = {
    id: string;
    created_at: string;
    prompt: string;
    actual: string;
    expected: string;
};
/** Device-local, deliberately untracked workspace for a person's improvement notes. */
export declare function skillEvolutionDirectory(environment?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform): string;
export declare function skillEvolutionPath(skill: string, directory?: string): string;
/** A private workspace whose eval cases use Skiller's existing evals/cases contract. */
export declare function privateEvaluationWorkspace(skill: string, directory?: string): string;
export declare function readSkillImprovementNotes(skill: string, directory?: string): SkillImprovementNote[];
export declare function addSkillImprovementNote(skill: string, input: Pick<SkillImprovementNote, "prompt" | "actual" | "expected">, directory?: string): SkillImprovementNote;
//# sourceMappingURL=skill-evolution.d.ts.map