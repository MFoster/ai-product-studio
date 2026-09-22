from __future__ import annotations

from pathlib import Path

import pytest

from ai_product_studio.scaffolding import initialize_studio


@pytest.fixture
def studio_root(tmp_path: Path) -> Path:
    root = tmp_path / "studio"
    initialize_studio(root, "Test Studio")
    return root
