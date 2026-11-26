from __future__ import annotations

import sys
from collections.abc import Callable
from typing import Any, TypeVar

import typer
from typer.core import TyperArgument, TyperCommand, TyperGroup, TyperOption

try:
    # Newer Typer versions bundle Click; older versions use the external package.
    from typer._click.exceptions import BadOptionUsage, MissingParameter
except ImportError:
    from click.exceptions import BadOptionUsage, MissingParameter

CommandFunction = TypeVar("CommandFunction", bound=Callable[..., Any])


def _can_prompt(ctx: typer.Context) -> bool:
    return not ctx.resilient_parsing and sys.stdin.isatty()


def _prompt_parameter(ctx: typer.Context, param: TyperArgument | TyperOption) -> Any:
    label = (param.name or "").replace("_", " ").capitalize()
    if isinstance(param, TyperOption):
        label += f" ({'/'.join(param.opts)})"
    choices = getattr(param.type, "choices", None)
    if choices:
        label += f" ({', '.join(str(choice) for choice in choices)})"
    default = param.get_default(ctx)
    if isinstance(param, TyperOption) and param.is_bool_flag:
        return typer.confirm(label, default=bool(default))

    def convert(value: str) -> Any:
        if value == "" and not param.required:
            return default
        return param.type_cast_value(ctx, value)

    return typer.prompt(
        label,
        default=default if default is not None or param.required else "",
        value_proc=convert,
        hide_input=isinstance(param, TyperOption) and param.hide_input,
    )


class InteractiveCommand(TyperCommand):
    def parse_args(self, ctx: typer.Context, args: list[str]) -> list[str]:
        if not _can_prompt(ctx):
            return super().parse_args(ctx, args)

        args = list(args)
        if ctx.meta.get("aps_guided") and not args:
            ctx.default_map = dict(ctx.default_map or {})
            for param in self.params:
                if isinstance(param, (TyperArgument, TyperOption)) and not param.is_eager:
                    ctx.default_map[param.name] = _prompt_parameter(ctx, param)

        while True:
            try:
                return super().parse_args(ctx, list(args))
            except MissingParameter as exc:
                param = exc.param
                if not isinstance(param, (TyperArgument, TyperOption)):
                    raise
                ctx.default_map = dict(ctx.default_map or {})
                ctx.default_map[param.name] = _prompt_parameter(ctx, param)
            except BadOptionUsage as exc:
                param = next(
                    (
                        param
                        for param in self.params
                        if isinstance(param, TyperOption) and exc.option_name in param.opts
                    ),
                    None,
                )
                if param is None or param.nargs != 1 or param.is_flag:
                    raise
                positions = [i for i, token in enumerate(args) if token == exc.option_name]
                if not positions:
                    raise
                value = _prompt_parameter(ctx, param)
                if value is None:
                    args.pop(positions[-1])
                else:
                    args.insert(positions[-1] + 1, str(value))


class InteractiveGroup(TyperGroup):
    def parse_args(self, ctx: typer.Context, args: list[str]) -> list[str]:
        if not args and _can_prompt(ctx):
            commands = {
                name: command for name, command in self.commands.items() if not command.hidden
            }
            typer.echo(f"\n{ctx.command_path}: choose a command")
            for index, (name, command) in enumerate(commands.items(), start=1):
                typer.echo(f"  {index}. {name} - {command.get_short_help_str()}")
            typer.echo("  0. Exit")

            def choose(value: str) -> str:
                if value.lower() in {"0", "q", "quit", "exit"}:
                    raise typer.Exit()
                if value in commands:
                    return value
                if value.isdecimal() and 1 <= int(value) <= len(commands):
                    return list(commands)[int(value) - 1]
                raise typer.BadParameter("Choose a command name or its number, or 0 to exit.")

            args = [typer.prompt("Command", value_proc=choose)]
            ctx.meta["aps_guided"] = True
        return super().parse_args(ctx, args)


class InteractiveTyper(typer.Typer):
    def __init__(self, *, help: str) -> None:
        super().__init__(cls=InteractiveGroup, no_args_is_help=True, help=help)

    def command(
        self, name: str | None = None, **kwargs: Any
    ) -> Callable[[CommandFunction], CommandFunction]:
        return super().command(name, cls=InteractiveCommand, **kwargs)
