from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from ai_product_studio.cli import app
from ai_product_studio.config import load_yaml
from ai_product_studio.configuration import parse_material_slugs
from ai_product_studio.scaffolding import create_product, create_product_line, create_variant


def test_parse_material_slugs_deduplicates_values() -> None:
    assert parse_material_slugs("PLA, petg, pla") == ["pla", "petg"]


def test_config_command_writes_printer_and_material_profiles(studio_root: Path) -> None:
    create_product_line(studio_root, "line", "Line")
    runner = CliRunner()
    user_input = "\n".join(
        [
            "Maker Studio",
            "large-corexy",
            "Large CoreXY",
            "300",
            "300",
            "320",
            "0.6",
            "1.8",
            "1.0",
            "y",
            "4",
            "Bambu Studio",
            "3mf",
            "pla,asa",
            "",
        ]
    )
    result = runner.invoke(
        app,
        ["config", "--root", str(studio_root), "--yes"],
        input=user_input,
    )

    assert result.exit_code == 0, result.output
    studio = load_yaml(studio_root / "config" / "studio.yaml")
    printer = load_yaml(studio_root / "config" / "printer" / "large-corexy.yaml")
    materials = load_yaml(studio_root / "config" / "material" / "material.yaml")
    assert studio["name"] == "Maker Studio"
    assert studio["default_printer"] == "large-corexy"
    assert studio["product_lines"] == ["line"]
    assert printer["build_volume_mm"] == {"x": 300.0, "y": 300.0, "z": 320.0}
    assert printer["supports_multi_material"] is True
    assert printer["max_material_slots"] == 4
    assert printer["supported_materials"] == ["pla", "asa"]
    assert [material["slug"] for material in materials["materials"]] == ["pla", "asa"]
    assert not (studio_root / "config" / "printer" / "generic-fdm.yaml").exists()

    create_variant(studio_root, "line", "variant", "Variant")
    product = create_product(studio_root, "line", "variant", "model", "Model")
    assert load_yaml(product / "product.yaml")["printer_profile"] == "large-corexy"
