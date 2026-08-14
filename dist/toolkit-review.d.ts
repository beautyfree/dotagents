export type ToolkitChangeKind = "new-local" | "kept-local" | "changed-local" | "missing-local";
export type ToolkitInventoryItem = {
    id: string;
    name: string;
    integrity: string;
};
export type ToolkitLibraryItem = {
    id: string;
    integrity?: string;
};
export type ToolkitChange = {
    id: string;
    name: string;
    kind: ToolkitChangeKind;
};
/**
 * Canonical, UI-agnostic local-vs-library classification. Consumers provide
 * only portable identifiers and integrity hashes; no application state or
 * machine paths leak into the result.
 */
export declare function classifyToolkitChanges(input: {
    items: readonly ToolkitInventoryItem[];
    library: readonly ToolkitLibraryItem[];
    observedIntegrity?: Readonly<Record<string, string>>;
    /** Device-only choices to keep a currently unchanged skill outside this library. */
    libraryExclusions?: Readonly<Record<string, {
        integrity: string;
    }>>;
}): ToolkitChange[];
export type ToolkitFileComparison = {
    local_state: "absent" | "directory" | "file" | "symlink" | "unsupported";
    local_file_count: number | null;
    library_file_count: number;
    changed_files: string[];
    only_on_computer: string[];
    only_in_library: string[];
    unchanged_file_count: number;
    local_skill_md?: string;
    library_skill_md?: string;
    local_skill_md_truncated?: boolean;
    library_skill_md_truncated?: boolean;
};
export type ToolkitFilePreview = {
    path: string;
    status: "added" | "modified" | "deleted";
    diff?: string;
    image_data_url?: string;
    unavailable_reason?: string;
};
export declare function compareToolkitSkill(input: {
    id: string;
    libraryPath: string;
    localPath: string;
}): ToolkitFileComparison;
export declare function previewToolkitChangedFile(input: {
    libraryPath: string;
    localPath: string;
    file: string;
    comparison: ToolkitFileComparison;
}): ToolkitFilePreview;
export declare function previewNewToolkitFile(input: {
    localPath: string;
    file: string;
    files: readonly string[];
}): ToolkitFilePreview;
//# sourceMappingURL=toolkit-review.d.ts.map