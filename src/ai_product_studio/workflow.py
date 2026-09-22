from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from ai_product_studio.config import dump_yaml, load_yaml
from ai_product_studio.models import (
    WORKFLOW_ORDER,
    PrinterProfile,
    ProductManifest,
    WorkflowEvent,
    WorkflowManifest,
    WorkflowStage,
)
from ai_product_studio.paths import find_studio_root


def load_workflow(product_dir: Path) -> WorkflowManifest:
    return WorkflowManifest.model_validate(load_yaml(product_dir / "workflow.yaml"))


def _required_artifacts(product_dir: Path, target: WorkflowStage) -> list[str]:
    errors: list[str] = []
    if (
        target
        in {
            WorkflowStage.DESIGN,
            WorkflowStage.REVIEW,
            WorkflowStage.PRINT_VALIDATION,
            WorkflowStage.RELEASE,
        }
        and not (product_dir / "product.yaml").is_file()
    ):
        errors.append("product.yaml is required")
    if target in {
        WorkflowStage.REVIEW,
        WorkflowStage.PRINT_VALIDATION,
        WorkflowStage.RELEASE,
    } and not any((product_dir / "source").glob("*.blend")):
        errors.append("at least one canonical .blend source is required")
    if target in {WorkflowStage.PRINT_VALIDATION, WorkflowStage.RELEASE}:
        previews = list((product_dir / "preview").glob("*.png"))
        if len(previews) < 2:
            errors.append("at least two PNG preview renders are required")
        if not (product_dir / "assets.yaml").is_file():
            errors.append("assets.yaml is required")
    if target is WorkflowStage.RELEASE:
        product = ProductManifest.model_validate(load_yaml(product_dir / "product.yaml"))
        root = find_studio_root(product_dir)
        printer = PrinterProfile.model_validate(
            load_yaml(root / "config" / "printer" / f"{product.printer_profile}.yaml")
        )
        extension = printer.package_format
        if not any((product_dir / "package").glob(f"*.{extension}")):
            errors.append(f"at least one {extension.upper()} package is required")
    return errors


def advance_workflow(
    product_dir: Path,
    target: WorkflowStage,
    *,
    note: str,
    approval: str | None = None,
) -> WorkflowManifest:
    workflow = load_workflow(product_dir)
    current_index = WORKFLOW_ORDER.index(workflow.current_stage)
    target_index = WORKFLOW_ORDER.index(target)
    if target_index != current_index + 1:
        raise ValueError(
            f"Workflow can only advance one stage at a time: "
            f"{workflow.current_stage.value} -> {target.value}"
        )
    errors = _required_artifacts(product_dir, target)
    if errors:
        raise ValueError("Cannot advance workflow: " + "; ".join(errors))
    if target in {WorkflowStage.REVIEW, WorkflowStage.PRINT_VALIDATION, WorkflowStage.RELEASE}:
        if not approval:
            raise ValueError(f"An approval reference is required to enter {target.value}")
        workflow.approvals[target.value] = approval
    if target is WorkflowStage.RELEASE and workflow.physical_print_status != "passed":
        raise ValueError("Physical print status must be passed before release")
    workflow.current_stage = target
    workflow.history.append(WorkflowEvent(stage=target, at=datetime.now(UTC), note=note))
    dump_yaml(product_dir / "workflow.yaml", workflow)
    return workflow


def record_print_result(
    product_dir: Path,
    status: str,
    *,
    evidence: str,
) -> WorkflowManifest:
    if status not in {"passed", "failed"}:
        raise ValueError("Print status must be 'passed' or 'failed'")
    if not evidence.strip():
        raise ValueError("Physical print evidence is required")
    workflow = load_workflow(product_dir)
    if workflow.current_stage is not WorkflowStage.PRINT_VALIDATION:
        raise ValueError("Physical print results can only be recorded during print-validation")
    workflow.physical_print_status = status
    workflow.approvals["physical-print"] = evidence
    workflow.history.append(
        WorkflowEvent(
            stage=WorkflowStage.PRINT_VALIDATION,
            at=datetime.now(UTC),
            note=f"Physical print {status}: {evidence}",
        )
    )
    dump_yaml(product_dir / "workflow.yaml", workflow)
    return workflow
