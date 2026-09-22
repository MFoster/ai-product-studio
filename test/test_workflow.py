from __future__ import annotations

from pathlib import Path

import pytest

from ai_product_studio.assets import inventory_product
from ai_product_studio.models import WorkflowStage
from ai_product_studio.scaffolding import create_product, create_product_line, create_variant
from ai_product_studio.workflow import advance_workflow


def test_workflow_requires_artifacts_and_approvals(studio_root: Path) -> None:
    create_product_line(studio_root, "line", "Line")
    create_variant(studio_root, "line", "variant", "Variant")
    product = create_product(studio_root, "line", "variant", "model", "Model")

    workflow = advance_workflow(product, WorkflowStage.DESIGN, note="Brief accepted")
    assert workflow.current_stage is WorkflowStage.DESIGN

    with pytest.raises(ValueError, match="canonical .blend"):
        advance_workflow(product, WorkflowStage.REVIEW, note="Review", approval="review-1")

    (product / "source" / "model.blend").write_bytes(b"blend")
    workflow = advance_workflow(
        product, WorkflowStage.REVIEW, note="Geometry reviewed", approval="review-1"
    )
    assert workflow.approvals["review"] == "review-1"

    with pytest.raises(ValueError, match="two PNG"):
        advance_workflow(
            product,
            WorkflowStage.PRINT_VALIDATION,
            note="Package review",
            approval="review-2",
        )

    (product / "preview" / "front.png").write_bytes(b"front")
    (product / "preview" / "back.png").write_bytes(b"back")
    inventory_product(product)
    workflow = advance_workflow(
        product,
        WorkflowStage.PRINT_VALIDATION,
        note="Ready for test print",
        approval="review-2",
    )
    assert workflow.current_stage is WorkflowStage.PRINT_VALIDATION
