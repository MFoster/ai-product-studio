from __future__ import annotations

from pathlib import Path

from ai_product_studio.skill_library import (
    REQUIRED_CORE_SECTIONS,
    read_skill_metadata,
    validate_skill_library,
)

CORE_SKILLS = {
    "mesh-printability-audit",
    "fit-tolerance-engineering",
    "wall-strength-engineering",
    "support-free-orientation",
    "fdm-detail-design",
    "curved-surface-relief",
    "ams-multipart-color",
    "threaded-container-mechanism",
    "organic-character-detail",
    "procedural-decoration-system",
    "model-repair-from-stl",
    "3mf-release-packaging",
    "test-print-feedback-loop",
    "catalog-render-and-review",
    "bambu-plate-planning",
}


def test_core_skill_library_is_complete_and_structured() -> None:
    root = Path(__file__).resolve().parents[1]
    skill_root = root / ".github" / "skills"
    discovered = {path.name for path in skill_root.iterdir() if path.is_dir()}

    assert discovered >= CORE_SKILLS
    assert validate_skill_library(root) == []
    for name in CORE_SKILLS:
        skill_file = skill_root / name / "SKILL.md"
        metadata = read_skill_metadata(skill_file)
        content = skill_file.read_text(encoding="utf-8")
        assert metadata["name"] == name
        assert all(section in content for section in REQUIRED_CORE_SECTIONS)


def test_skill_validation_rejects_mismatched_directory(tmp_path: Path) -> None:
    skill = tmp_path / ".github" / "skills" / "expected-name"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: wrong-name\ndescription: Incorrectly named skill.\n---\n",
        encoding="utf-8",
    )

    errors = validate_skill_library(tmp_path)
    assert len(errors) == 1
    assert "frontmatter name must match directory" in errors[0]
