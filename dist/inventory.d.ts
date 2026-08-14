import type { DotagentsResult } from "./issues.js";
export interface ScanLimits {
    maxFilesPerSkill: number;
    maxFileBytes: number;
    maxSkillBytes: number;
}
export declare const DEFAULT_SCAN_LIMITS: ScanLimits;
export interface OwnedSkillInventory {
    name: string;
    path: string;
    fileCount: number;
    bytes: number;
    integrity: string;
    /**
     * Stable portable bundle hash used by clients which copy owned skill files.
     * It intentionally excludes machine-local dotagents metadata.
     */
    exportHash?: string;
    /** Present for verified dependency cache entries; absent for owned skills. */
    sourceRoot?: string;
    sourceKind?: "dependency";
    dependency?: string;
}
export interface LibraryInventory {
    root: string;
    name: string;
    version: string;
    ownedSkills: OwnedSkillInventory[];
    dependencyCount: number;
    locked: boolean;
}
export interface ScannedSkill extends OwnedSkillInventory {
    root: string;
}
/** A linked file may be bundled only when it resolves inside a reviewed root. */
export interface OwnedSkillScanOptions {
    trustedFileRoots?: readonly string[];
}
export declare function declaredSkillName(skillMd: string): string | null;
export declare function scanOwnedSkill(root: string, skillPath: string, limits?: ScanLimits, options?: OwnedSkillScanOptions): Promise<DotagentsResult<ScannedSkill>>;
export declare function scanLibrary(root: string, limits?: ScanLimits): Promise<DotagentsResult<LibraryInventory>>;
//# sourceMappingURL=inventory.d.ts.map