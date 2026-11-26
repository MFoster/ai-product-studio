export type SchemaName =
  | "studio"
  | "product-line"
  | "variant"
  | "product"
  | "asset"
  | "group"
  | "material"
  | "workflow"
  | "printer"
  | "slice"
  | "release";
export const schemaNames: readonly SchemaName[];
export const schemaDirectory: string;
export function readSchema(name: string): Record<string, unknown>;

export type WorkflowStage =
  "brief" | "design" | "review" | "print-validation" | "release";

export interface Workflow {
  schema_version: string;
  product: string;
  current_stage: WorkflowStage;
  approvals: Record<string, string>;
  blockers: string[];
  physical_print_status: "pending" | "passed" | "failed";
  history: { stage: WorkflowStage; at: string; note: string }[];
}

export interface Product {
  slug: string;
  printer_profile: string;
}

export interface Printer {
  schema_version: string;
  slug: string;
  name: string;
  technology: "FDM";
  build_volume_mm: Record<string, number>;
  supports_multi_material: boolean;
  max_material_slots: number;
  package_format: "3mf" | "stl";
  nozzle_diameter_mm: number;
  minimum_wall_mm: number;
  minimum_detail_mm: number;
  supported_materials: string[];
  slicer: string;
  slicing: "manual";
}

export interface Studio {
  schema_version: string;
  name: string;
  default_printer: string;
  material_config: string;
  product_lines: string[];
  registry_index: string;
}

export interface AssetRecord {
  path: string;
  kind: "source" | "export" | "package" | "preview" | "backup" | "document";
  format: string;
  role: string;
  sha256: string;
  size_bytes: number;
  source?: string | null;
  release_eligible: boolean;
}

export interface GroupMesh {
  asset: string;
  material: string;
  sha256: string;
}

export interface AssetGroup {
  id: string;
  name: string;
  revision: string;
  description: string;
  package: string;
  materials: GroupMaterial[];
  parts: GroupPart[];
  layout: {
    spacing_mm: number;
    margin_mm: number;
    orientation: "preserve-source";
  };
}

export interface Assets {
  product: string;
  assets: AssetRecord[];
  groups: AssetGroup[];
}

export interface SliceProfile {
  schema_version: string;
  slug: string;
  name: string;
  product: string;
  printer_profile: string;
  evidence: "captured" | "stated";
  recorded_at: string;
  source: string | null;
  source_sha256: string | null;
  settings_file: string | null;
  settings_sha256: string | null;
  slicer: string;
  slicer_version: string | null;
  printer_model: string | null;
  printer_settings_id: string | null;
  print_settings_id: string | null;
  filament_settings_ids: string[];
  filament_types: string[];
  nozzle_diameter_mm: number;
  layer_height_mm: number;
  first_layer_height_mm: number;
  wall_loops: number;
  sparse_infill_density: string | null;
  support_enabled: boolean;
  support_type: string | null;
  brim_type: string | null;
  build_plate: string | null;
  notes: string[];
}

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordData = { [key: string]: Json };

export interface GroupMaterial {
  id: string;
  name: string;
  color: string;
  material: string;
}

export interface GroupPart {
  id: string;
  name: string;
  quantity: number;
  meshes: GroupMesh[];
}

export type ModelGroup = AssetGroup;
