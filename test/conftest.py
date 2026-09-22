from __future__ import annotations

from pathlib import Path

import pytest

from ai_product_studio.config import dump_yaml
from ai_product_studio.models import StudioManifest


@pytest.fixture
def studio_root(tmp_path: Path) -> Path:
    root = tmp_path / "studio"
    dump_yaml(
        root / "config" / "studio.yaml",
        StudioManifest(name="Test Studio", default_printer="generic-fdm"),
    )
    return root
