from __future__ import annotations

from pathlib import Path

from ai_product_studio.registry import check, sync
from ai_product_studio.scaffolding import create_product_line


def test_registry_syncs_agents_skills_and_references_idempotently(studio_root: Path) -> None:
    line = create_product_line(studio_root, "winter-village", "Winter Village")
    agent = line / "ai" / "agent" / "architect.agent.md"
    agent.write_text(
        "---\nname: architect\ndescription: Design the village architecture.\n---\n\n# Architect\n",
        encoding="utf-8",
    )
    skill = line / "ai" / "skill" / "winter-village-facades"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: winter-village-facades\n"
        "description: Create printable winter village facades.\n---\n\n# Facades\n",
        encoding="utf-8",
    )
    (skill / "reference.md").write_text("# Reference\n", encoding="utf-8")

    first = sync(studio_root)
    first_index = (studio_root / ".aps" / "registry.yaml").read_text(encoding="utf-8")
    second = sync(studio_root)
    second_index = (studio_root / ".aps" / "registry.yaml").read_text(encoding="utf-8")

    assert len(first) == len(second) == 3
    assert first_index == second_index
    assert (studio_root / ".github" / "agents" / "winter-village--architect.agent.md").is_file()
    assert (
        studio_root / ".github" / "skills" / "winter-village-facades" / "reference.md"
    ).is_file()
    assert check(studio_root) == []


def test_empty_registry_does_not_require_generated_index(studio_root: Path) -> None:
    assert check(studio_root) == []
