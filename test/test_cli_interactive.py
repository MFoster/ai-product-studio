from __future__ import annotations

from pathlib import Path

import pytest
import typer
from typer.core import TyperCommand
from typer.testing import CliRunner

from ai_product_studio.cli import app
from ai_product_studio.config import load_yaml
from ai_product_studio.interactive import InteractiveTyper, _can_prompt
from ai_product_studio.models import WorkflowStage
from ai_product_studio.scaffolding import initialize_studio

runner = CliRunner()


@pytest.fixture(autouse=True)
def terminal(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "ai_product_studio.interactive._can_prompt", lambda ctx: not ctx.resilient_parsing
    )


def test_external_studio_environment_and_explicit_root(
    studio_root: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = tmp_path / "other-studio"
    initialize_studio(other, "Other")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("APS_STUDIO_ROOT", str(studio_root))

    result = runner.invoke(app, ["product-line", "create", "env-line", "--name", "Environment"])
    assert result.exit_code == 0, result.output
    assert (studio_root / "product-line/env-line/product-line.yaml").is_file()
    assert not (other / "product-line/env-line").exists()

    result = runner.invoke(
        app,
        ["product-line", "create", "explicit-line", "--name", "Explicit", "--root", str(other)],
    )
    assert result.exit_code == 0, result.output
    assert (other / "product-line/explicit-line/product-line.yaml").is_file()
    assert not (studio_root / "product-line/explicit-line").exists()


def test_invalid_studio_environment_does_not_fall_back(
    studio_root: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(studio_root)
    monkeypatch.setenv("APS_STUDIO_ROOT", str(tmp_path / "missing"))
    result = runner.invoke(app, ["registry", "check"])
    assert result.exit_code == 1
    assert "APS_STUDIO_ROOT is not a studio" in result.output

    result = runner.invoke(app, ["registry", "check", "--root", str(studio_root)])
    assert result.exit_code == 0, result.output


def test_root_menu_prompts_for_every_parameter(tmp_path: Path) -> None:
    destination = tmp_path / "Guided studio"
    result = runner.invoke(app, [], input=f"init\n{destination}\nGuided Studio\nn\nn\n")

    assert result.exit_code == 0, result.output
    assert "choose a command" in result.output
    assert "Destination" in result.output
    assert "Name (--name)" in result.output
    assert "Dry run (--dry-run)" in result.output
    assert "Force (--force)" in result.output
    assert load_yaml(destination / "config/studio.yaml")["name"] == "Guided Studio"


def test_nested_menu_prompts_for_optional_values(studio_root: Path) -> None:
    result = runner.invoke(
        app,
        [],
        input=f"product-line\n1\nwinter-village\nWinter Village\nA snowy village\n"
        f"{studio_root}\nn\nn\n",
    )

    assert result.exit_code == 0, result.output
    manifest = load_yaml(studio_root / "product-line/winter-village/product-line.yaml")
    assert manifest["name"] == "Winter Village"
    assert manifest["description"] == "A snowy village"


def test_group_menu_accepts_defaults(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    result = runner.invoke(app, ["registry"], input="check\n\n")

    assert "Root (--root)" in result.output
    assert "Aborted" not in result.output
    assert "Error:" in result.output
    assert result.exit_code == 1


def test_missing_required_option_preserves_arguments(studio_root: Path) -> None:
    result = runner.invoke(
        app,
        ["product-line", "create", "winter-village", "--root", str(studio_root)],
        input="Winter Village\n",
    )

    assert result.exit_code == 0, result.output
    assert "Name (--name)" in result.output
    assert "Description" not in result.output
    assert (studio_root / "product-line/winter-village/product-line.yaml").is_file()


def test_missing_arguments_and_option_are_all_prompted(studio_root: Path) -> None:
    result = runner.invoke(
        app,
        ["product-line", "create", "--root", str(studio_root)],
        input="winter-village\nWinter Village\n",
    )

    assert result.exit_code == 0, result.output
    assert "Slug" in result.output
    assert "Name (--name)" in result.output
    assert (studio_root / "product-line/winter-village/product-line.yaml").is_file()


@pytest.mark.parametrize("option", ["--name", "--name=Earlier --name"])
def test_option_without_value_is_prompted(studio_root: Path, option: str) -> None:
    result = runner.invoke(
        app,
        ["product-line", "create", "winter-village", "--root", str(studio_root), *option.split()],
        input="Winter Village\n",
    )

    assert result.exit_code == 0, result.output
    manifest = load_yaml(studio_root / "product-line/winter-village/product-line.yaml")
    assert manifest["name"] == "Winter Village"


def test_optional_option_without_value_is_prompted(studio_root: Path) -> None:
    result = runner.invoke(app, ["registry", "check", "--root"], input=f"{studio_root}\n")

    assert result.exit_code == 0, result.output
    assert "Root (--root)" in result.output


def test_optional_missing_value_can_be_left_unset(
    studio_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(studio_root)
    result = runner.invoke(app, ["registry", "check", "--root"], input="\n")

    assert result.exit_code == 0, result.output
    assert "Registry is synchronized" in result.output


def test_complete_command_does_not_prompt(studio_root: Path) -> None:
    result = runner.invoke(
        app,
        [
            "product-line",
            "create",
            "winter-village",
            "--name",
            "Winter Village",
            "--root",
            str(studio_root),
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Name (--name)" not in result.output
    assert "choose a command" not in result.output


def test_menu_retries_invalid_choice_and_can_exit() -> None:
    result = runner.invoke(app, [], input="not-a-command\n0\n")

    assert result.exit_code == 0, result.output
    assert "Choose a command name or its number" in result.output


def test_cancellation_does_not_create_workspace(tmp_path: Path) -> None:
    destination = tmp_path / "cancelled"
    result = runner.invoke(app, [], input=f"init\n{destination}\n")

    assert result.exit_code == 1
    assert "Aborted" in result.output
    assert not destination.exists()


@pytest.mark.parametrize("args", [[], ["product"], ["product-line", "create"]])
def test_eof_aborts_cleanly(args: list[str]) -> None:
    result = runner.invoke(app, args, input="")

    assert result.exit_code == 1
    assert "Aborted" in result.output
    assert not isinstance(result.exception, (TypeError, AttributeError))


@pytest.mark.parametrize(
    "args",
    [[], ["product"], ["product-line", "create"], ["product-line", "create", "winter", "--name"]],
)
def test_non_terminal_keeps_usage_errors(monkeypatch: pytest.MonkeyPatch, args: list[str]) -> None:
    monkeypatch.setattr("ai_product_studio.interactive._can_prompt", lambda ctx: False)
    result = runner.invoke(app, args)

    assert result.exit_code == 2, result.output
    assert "Command:" not in result.output
    assert "Aborted" not in result.output


@pytest.mark.parametrize(
    "args", [["--help"], ["product", "--help"], ["product", "create", "--help"]]
)
def test_explicit_help_never_prompts(args: list[str]) -> None:
    result = runner.invoke(app, args)

    assert result.exit_code == 0, result.output
    assert "Command:" not in result.output
    assert "Aborted" not in result.output


def test_invalid_option_is_not_hidden_by_prompting() -> None:
    result = runner.invoke(app, ["product-line", "create", "--unknown"])

    assert result.exit_code == 2, result.output
    assert "No such option" in result.output
    assert "Aborted" not in result.output


@pytest.mark.parametrize(
    ("isatty", "resilient", "expected"),
    [(True, False, True), (False, False, False), (True, True, False)],
)
def test_prompting_requires_terminal_and_normal_parsing(
    monkeypatch: pytest.MonkeyPatch, isatty: bool, resilient: bool, expected: bool
) -> None:
    monkeypatch.setattr("ai_product_studio.interactive.sys.stdin.isatty", lambda: isatty)
    ctx = typer.Context(TyperCommand(name="test"), resilient_parsing=resilient)

    assert _can_prompt(ctx) is expected


def test_prompt_retries_invalid_typed_argument() -> None:
    typed_app = InteractiveTyper(help="Test typed prompts.")

    @typed_app.command()
    def count(value: int, stage: WorkflowStage) -> None:
        typer.echo(f"Count: {value}; stage: {stage.value}")

    result = runner.invoke(typed_app, [], input="not-a-number\n3\nnot-a-stage\nreview\n")

    assert result.exit_code == 0, result.output
    assert "'not-a-number' is not a valid" in result.output
    assert "'not-a-stage' is not one of" in result.output
    assert "Count: 3; stage: review" in result.output
