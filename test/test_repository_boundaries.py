from __future__ import annotations

import subprocess
from pathlib import Path


def test_framework_gitignore_separates_studio_and_generated_files(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / ".gitignore").write_text(
        (root / ".gitignore").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (tmp_path / ".specify").mkdir()
    (tmp_path / ".specify" / ".gitignore").write_text(
        (root / ".specify" / ".gitignore").read_text(encoding="utf-8"), encoding="utf-8"
    )
    for path, ignored in (
        (".specify/integration.json", False),
        (".specify/feature.json", True),
        (".specify/integrations/packages.json", True),
        ("result.json", True),
        (".toolkit/manifest.json", True),
        ("apps/aps_cli/capabilities/.github/skills/example/SKILL.md", True),
        ("config/studio.yaml", True),
        ("product-line/example/asset.blend", True),
        (".github/agents/example--designer.agent.md", True),
        (".github/skills/example-design/SKILL.md", True),
        (".github/skills/speckit-plan/SKILL.md", False),
        (".github/agents/studio-orchestrator.agent.md", False),
        (".github/agents/product-line-curator.agent.md", False),
        (".github/skills/mesh-printability-audit/SKILL.md", False),
        (".github/skills/calibration-coupon-design/SKILL.md", False),
    ):
        result = subprocess.run(
            ["git", "-C", str(tmp_path), "check-ignore", "-q", "--no-index", path],
            check=False,
        )
        assert result.returncode == (0 if ignored else 1), path
