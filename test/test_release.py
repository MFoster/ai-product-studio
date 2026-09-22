from __future__ import annotations

from pathlib import Path

import pytest

from ai_product_studio.assets import inventory_product
from ai_product_studio.models import WorkflowStage
from ai_product_studio.release import create_release
from ai_product_studio.scaffolding import create_product, create_product_line, create_variant
from ai_product_studio.workflow import advance_workflow, record_print_result


def test_release_requires_and_records_physical_print(studio_root: Path) -> None:
    create_product_line(studio_root, "line", "Line")
    create_variant(studio_root, "line", "variant", "Variant")
    product = create_product(studio_root, "line", "variant", "model", "Model")
    (product / "source" / "model.blend").write_bytes(b"blend")
    (product / "preview" / "front.png").write_bytes(b"front")
    (product / "preview" / "back.png").write_bytes(b"back")
    (product / "package" / "model.3mf").write_bytes(b"package")
    inventory_product(product)

    advance_workflow(product, WorkflowStage.DESIGN, note="Brief accepted")
    advance_workflow(product, WorkflowStage.REVIEW, note="Reviewed", approval="review-1")
    advance_workflow(
        product,
        WorkflowStage.PRINT_VALIDATION,
        note="Ready to print",
        approval="review-2",
    )
    with pytest.raises(ValueError, match="passed physical print"):
        create_release(product, "v1", approval="release-1")

    record_print_result(product, "passed", evidence="test-print-001")
    release = create_release(product, "v1", approval="release-1")
    assert release.is_file()
    with pytest.raises(FileExistsError, match="immutable"):
        create_release(product, "v1", approval="release-2")
