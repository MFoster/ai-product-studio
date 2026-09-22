from __future__ import annotations

from typer.testing import CliRunner

from ai_product_studio.cli import app


def test_root_help_describes_every_command() -> None:
    result = CliRunner().invoke(app, ["--help"])

    assert result.exit_code == 0
    output = " ".join(result.output.split())
    expected_descriptions = (
        "Initialize a new AI Product Studio directory.",
        "Interactively configure the studio printer",
        "Create and manage product-line workspaces.",
        "Create and manage variants within a product line.",
        "Create and manage individual printable products.",
        "Synchronize product-local agents and skills into .github.",
        "Inventory managed products and unmanaged legacy assets.",
        "Inspect and advance gated product workflow stages.",
        "Generate JSON Schemas from the typed manifest models.",
        "Create immutable product release manifests.",
        "Validate studio manifests, assets, skills, and registry state.",
    )
    for description in expected_descriptions:
        assert description in output


def test_group_help_describes_subcommands() -> None:
    runner = CliRunner()
    expectations = {
        "registry": (
            "Publish product-local agents and skills",
            "Check that the generated .github registry is current.",
        ),
        "assets": (
            "Write a checksummed assets.yaml",
            "Report unmanaged model assets",
        ),
        "workflow": (
            "Show a product's current workflow",
            "Advance a product by one workflow stage",
            "Record passed or failed physical test-print evidence.",
        ),
    }
    for group, descriptions in expectations.items():
        result = runner.invoke(app, [group, "--help"])
        assert result.exit_code == 0
        output = " ".join(result.output.split())
        for description in descriptions:
            assert description in output
