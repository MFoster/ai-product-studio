import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { stringify } from "./yaml.js";
import {
  loadAssets,
  loadPrinter,
  loadProduct,
  loadWorkflow,
  type Workflow,
  type WorkflowStage,
} from "./manifests.js";
import { matchesPathSuffix, resolvePath } from "./paths.js";

export const workflowOrder: WorkflowStage[] = [
  "brief",
  "design",
  "review",
  "print-validation",
  "release",
];

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    )
      return false;
    throw error;
  }
}

function matches(directory: string, suffix: string): string[] {
  try {
    return readdirSync(directory).filter((entry) =>
      matchesPathSuffix(entry, suffix),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    )
      return [];
    throw error;
  }
}

function rootFrom(productDir: string): string {
  let current = resolvePath(productDir);
  while (true) {
    if (isFile(path.join(current, "config/studio.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(
        "Could not find AI Product Studio root; expected config/studio.yaml in this directory or a parent.",
      );
    current = parent;
  }
}

function artifacts(productDir: string, target: WorkflowStage): string[] {
  const errors: string[] = [];
  if (target !== "brief" && !isFile(path.join(productDir, "product.yaml")))
    errors.push("product.yaml is required");
  if (
    ["review", "print-validation", "release"].includes(target) &&
    matches(path.join(productDir, "source"), ".blend").length === 0
  )
    errors.push("at least one canonical .blend source is required");
  if (target === "print-validation" || target === "release") {
    if (matches(path.join(productDir, "preview"), ".png").length < 2)
      errors.push("at least two PNG preview renders are required");
    if (!isFile(path.join(productDir, "assets.yaml")))
      errors.push("assets.yaml is required");
  }
  if (target === "release") {
    const product = loadProduct(productDir);
    const printer = loadPrinter(
      path.join(
        rootFrom(productDir),
        "config/printer",
        `${product.printer_profile}.yaml`,
      ),
    );
    if (
      matches(path.join(productDir, "package"), `.${printer.package_format}`)
        .length === 0
    )
      errors.push(
        `at least one ${printer.package_format.toUpperCase()} package is required`,
      );
  }
  return errors;
}

function save(productDir: string, workflow: Workflow): void {
  writeFileSync(path.join(productDir, "workflow.yaml"), stringify(workflow));
}

export function advance(
  productDir: string,
  target: WorkflowStage,
  note: string,
  approval?: string,
): Workflow {
  const workflow = loadWorkflow(productDir);
  if (
    workflowOrder.indexOf(target) !==
    workflowOrder.indexOf(workflow.current_stage) + 1
  )
    throw new Error(
      `Workflow can only advance one stage at a time: ${workflow.current_stage} -> ${target}`,
    );
  const errors = artifacts(productDir, target);
  if (errors.length)
    throw new Error(`Cannot advance workflow: ${errors.join("; ")}`);
  if (["review", "print-validation", "release"].includes(target)) {
    if (!approval)
      throw new Error(`An approval reference is required to enter ${target}`);
    workflow.approvals[target] = approval;
  }
  if (target === "release" && workflow.physical_print_status !== "passed")
    throw new Error("Physical print status must be passed before release");
  workflow.current_stage = target;
  workflow.history.push({ stage: target, at: new Date().toISOString(), note });
  save(productDir, workflow);
  return workflow;
}

export function printResult(
  productDir: string,
  status: string,
  evidence: string,
): Workflow {
  if (status !== "passed" && status !== "failed")
    throw new Error("Print status must be 'passed' or 'failed'");
  if (!evidence.trim()) throw new Error("Physical print evidence is required");
  const workflow = loadWorkflow(productDir);
  if (workflow.current_stage !== "print-validation")
    throw new Error(
      "Physical print results can only be recorded during print-validation",
    );
  workflow.physical_print_status = status;
  workflow.approvals["physical-print"] = evidence;
  workflow.history.push({
    stage: "print-validation",
    at: new Date().toISOString(),
    note: `Physical print ${status}: ${evidence}`,
  });
  save(productDir, workflow);
  return workflow;
}

export function createRelease(
  productDir: string,
  version: string,
  approval: string,
  notes: string,
): string {
  const destination = path.resolve(
    productDir,
    "release",
    version,
    "release.yaml",
  );
  if (existsSync(destination))
    throw new Error(`Release already exists and is immutable: ${destination}`);
  const workflow = loadWorkflow(productDir);
  if (workflow.current_stage !== "print-validation")
    throw new Error("Product must be in print-validation before release");
  if (workflow.physical_print_status !== "passed")
    throw new Error("A passed physical print is required before release");
  const product = loadProduct(productDir);
  const assets = loadAssets(productDir);
  const hashes: Record<string, string> = {};
  for (const asset of assets.assets)
    if (asset.release_eligible) hashes[asset.path] = asset.sha256;
  advance(productDir, "release", `Released ${version}`, approval);
  if (!Object.keys(hashes).length)
    throw new Error("a release must include at least one asset hash");
  const release = {
    schema_version: "1.0",
    product: product.slug,
    version,
    created_at: new Date().toISOString(),
    printer_profile: product.printer_profile,
    asset_hashes: hashes,
    validations: [
      "asset checksums recorded",
      "workflow gates satisfied",
      "physical print passed",
    ],
    physical_print_status: "passed",
    notes,
  };
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, stringify(release));
  return destination;
}
