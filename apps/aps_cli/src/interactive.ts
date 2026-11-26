import { Prompts } from "./prompts.js";

type Parameter = {
  key: string;
  positional?: boolean;
  required?: boolean;
  defaultValue?: string;
  flag?: boolean;
  choices?: string[];
  help?: string;
  path?: boolean;
};

const root: Parameter = {
  key: "root",
  path: true,
  help: "Studio root; overrides APS_STUDIO_ROOT and directory discovery.",
};
const boolean = (key: string, help?: string): Parameter => ({
  key,
  flag: true,
  help,
});
const arg = (
  key: string,
  required = true,
  defaultValue?: string,
): Parameter => ({
  key,
  positional: true,
  required,
  defaultValue,
  path: ["destination", "product-path", "source", "project"].includes(key),
});
const option = (
  key: string,
  required = false,
  defaultValue?: string,
): Parameter => ({
  key,
  required,
  defaultValue,
  path: key === "output",
});
const specs: Record<string, Parameter[]> = {
  config: [root, boolean("yes", "Write without final confirmation.")],
  init: [
    arg("destination", false, "."),
    option("name", false, "AI Product Studio"),
    boolean("dry-run"),
    boolean("force"),
  ],
  validate: [root],
  "product-line create": [
    arg("slug"),
    option("name", true),
    option("description", false, ""),
    root,
    boolean("dry-run"),
    boolean("force"),
  ],
  "variant create": [
    arg("product-line"),
    arg("slug"),
    option("name", true),
    option("theme", false, ""),
    root,
    boolean("dry-run"),
    boolean("force"),
  ],
  "product create": [
    arg("product-line"),
    arg("variant"),
    arg("slug"),
    option("name", true),
    option("summary", false, ""),
    root,
    boolean("dry-run"),
    boolean("force"),
  ],
  "registry sync": [root, boolean("dry-run")],
  "registry check": [root],
  "toolkit sync": [root, boolean("dry-run")],
  "toolkit check": [root],
  "assets inventory": [arg("product-path"), root],
  "assets package": [
    arg("product-path"),
    { ...option("group"), help: "Build only this group ID." },
    root,
  ],
  "assets legacy-inventory": [
    arg("source"),
    option("output", false, "report/legacy-assets.yaml"),
    root,
  ],
  "workflow status": [arg("product-path"), root],
  "workflow advance": [
    arg("product-path"),
    {
      ...arg("stage"),
      choices: ["brief", "design", "review", "print-validation", "release"],
    },
    option("note", true),
    option("approval"),
    root,
  ],
  "workflow print-result": [
    arg("product-path"),
    arg("status"),
    option("evidence", true),
    root,
  ],
  "schema write": [root],
  "release create": [
    arg("product-path"),
    arg("version"),
    option("approval", true),
    option("notes", false, ""),
    root,
  ],
  "slicer capture": [
    arg("product-path"),
    arg("project"),
    option("slug"),
    option("name"),
    option("note"),
    boolean("force"),
    root,
  ],
  "slicer list": [arg("product-path"), root],
};
const commands = [
  "config",
  "init",
  "validate",
  "product-line",
  "variant",
  "product",
  "registry",
  "assets",
  "workflow",
  "schema",
  "release",
  "slicer",
  "toolkit",
];
const groups: Record<string, string[]> = {
  "product-line": ["create"],
  variant: ["create"],
  product: ["create"],
  registry: ["sync", "check"],
  assets: ["inventory", "package", "legacy-inventory"],
  workflow: ["status", "advance", "print-result"],
  schema: ["write"],
  release: ["create"],
  slicer: ["capture", "list"],
  toolkit: ["sync", "check"],
};
const descriptions: Record<string, string> = {
  config: "Interactively configure the studio printer and material profiles.",
  init: "Initialize a new AI Product Studio directory.",
  validate: "Validate studio manifests, assets, skills, and registry state.",
  "product-line": "Create and manage product-line workspaces.",
  variant: "Create and manage variants within a product line.",
  product: "Create and manage individual printable products.",
  registry: "Synchronize product-local agents and skills into .github.",
  assets: "Inventory managed products and unmanaged legacy assets.",
  workflow: "Inspect and advance gated product workflow stages.",
  schema: "Generate JSON Schemas from the typed manifest models.",
  release: "Create immutable product release manifests.",
  slicer: "Capture and inspect the slicer settings a product is printed with.",
  toolkit:
    "Install and check versioned AI capabilities in an independent studio.",
  "toolkit sync":
    "Synchronize toolkit and studio capabilities without overwriting local edits.",
  "toolkit check": "Check installed toolkit version and capability checksums.",
  "product-line create": "Create a product-line workspace and manifest.",
  "variant create": "Create a named variant under a product line.",
  "product create": "Create a product workspace directly under a variant.",
  "registry sync":
    "Publish product-local agents and skills to the root .github registry.",
  "registry check": "Check that the generated .github registry is current.",
  "assets inventory": "Write a checksummed assets.yaml for a managed product.",
  "assets package":
    "Compose named asset groups into complete, unsliced multi-plate 3MF files.",
  "assets legacy-inventory":
    "Report unmanaged model assets without moving or modifying them.",
  "workflow status": "Show a product's current workflow and print status.",
  "workflow advance":
    "Advance a product by one workflow stage after validating its evidence.",
  "workflow print-result":
    "Record passed or failed physical test-print evidence.",
  "schema write": "Regenerate JSON Schema files from manifest models.",
  "release create":
    "Create an immutable release manifest after physical validation.",
  "slicer capture":
    "Record the slicer settings from a saved slicer project (.3mf) as print evidence.",
  "slicer list": "List the slice profiles recorded for a product.",
};

function groupFor(key: string): string[] | undefined {
  return Object.hasOwn(groups, key) ? groups[key] : undefined;
}

function specFor(key: string): Parameter[] | undefined {
  return Object.hasOwn(specs, key) ? specs[key] : undefined;
}

export function normalizeCommandBoundaries(args: string[]): string[] {
  const result = args[0] === "--" ? args.slice(1) : [...args];
  if (groupFor(result[0]) && result[1] === "--") result.splice(1, 1);
  return result;
}

export function positionalNames(command: string[]): string[] {
  return (specFor(command.join(" ")) ?? [])
    .filter((parameter) => parameter.positional && parameter.required)
    .map((parameter) => parameter.key.replaceAll("-", "_"));
}

export function commandOptions(command: string[]): Map<string, boolean> {
  return new Map(
    (specFor(command.join(" ")) ?? [])
      .filter((parameter) => !parameter.positional)
      .map((parameter) => [parameter.key, parameter.flag === true]),
  );
}

export function helpError(args: string[]): string | null {
  let length = 0;
  if (!args[0]?.startsWith("-")) {
    if (!commands.includes(args[0])) return `No such command '${args[0]}'.`;
    length = 1;
    const group = groupFor(args[0]);
    if (group && args[1] && !args[1].startsWith("-")) {
      if (!group.includes(args[1])) return `No such command '${args[1]}'.`;
      length = 2;
    }
  }
  const parameters = specFor(args.slice(0, length).join(" ")) ?? [];
  const options = new Map(
    parameters
      .filter((parameter) => !parameter.positional)
      .map((parameter) => [`--${parameter.key}`, parameter]),
  );
  options.set("--help", boolean("help"));
  if (length === 0) {
    options.set("--install-completion", boolean("install-completion"));
    options.set("--show-completion", boolean("show-completion"));
  }
  if (args[0] === "config") options.set("-y", boolean("yes"));
  for (let index = length; index < args.length; index++) {
    const token = args[index];
    if (token === "--") break;
    if (!token.startsWith("-") || token === "-") continue;
    const option = token.split("=", 1)[0];
    const parameter = options.get(option);
    if (!parameter) return `No such option: ${option}`;
    if (parameter.flag && token.includes("="))
      return `Option '${option}' does not take a value.`;
    if (!parameter.flag && !token.includes("=")) {
      if (++index >= args.length)
        return `Option '${option}' requires an argument.`;
    }
  }
  return null;
}

export function requestsHelp(args: string[]): boolean {
  const commandLength = groupFor(args[0]) ? 2 : 1;
  const parameters = specFor(args.slice(0, commandLength).join(" ")) ?? [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--") return false;
    if (token === "--help") return true;
    if (
      parameters.some(
        (parameter) =>
          !parameter.positional &&
          !parameter.flag &&
          token === `--${parameter.key}`,
      )
    )
      index++;
  }
  return false;
}

export function helpText(args: string[]): string | null {
  const helpIndex = args.indexOf("--help");
  const command =
    helpIndex === 0
      ? []
      : groupFor(args[0]) && helpIndex > 1
        ? args.slice(0, 2)
        : args.slice(0, 1);
  if (!command.length) {
    return `Usage: aps [OPTIONS] COMMAND [ARGS]...\n\nManage AI-first printable product lines.\n\nOptions:\n  --install-completion  Install completion for the current shell.\n  --show-completion     Show completion for the current shell.\n  --help                Show this message and exit.\n\nCommands:\n${commands.map((name) => `  ${name.padEnd(14)} ${descriptions[name]}`).join("\n")}\n`;
  }
  const key = command.join(" ");
  const group = groupFor(key);
  if (group) {
    return `Usage: aps ${key} [OPTIONS] COMMAND [ARGS]...\n\n${descriptions[key]}\n\nOptions:\n  --help  Show this message and exit.\n\nCommands:\n${group.map((name) => `  ${name.padEnd(18)} ${descriptions[`${key} ${name}`]}`).join("\n")}\n`;
  }
  const parameters = specFor(key);
  if (!parameters) return null;
  const argumentsText = parameters
    .filter((parameter) => parameter.positional)
    .map((parameter) => {
      const name = parameter.key.replaceAll("-", "_");
      const value = parameter.required ? `{${name}}` : `[${name}]`;
      return parameter.choices
        ? `${value}:<${parameter.choices.join("|")}>`
        : value;
    })
    .join(" ");
  const argumentDetails = parameters
    .filter((parameter) => parameter.positional)
    .map(
      (parameter) =>
        `  ${parameter.key.replaceAll("-", "_")}  <${parameter.choices ? parameter.choices.join("|") : parameter.path ? "path" : "str"}>${parameter.required ? "  [required]" : ""}${parameter.defaultValue ? `  [default: ${parameter.defaultValue}]` : ""}`,
    )
    .join("\n");
  const optionsText = parameters
    .filter((parameter) => !parameter.positional)
    .map(
      (parameter) =>
        `  --${parameter.key}${key === "config" && parameter.key === "yes" ? ", -y" : ""}${parameter.flag ? "" : ` <${parameter.path ? "path" : "str"}>`}${parameter.required ? "  [required]" : ""}${parameter.defaultValue ? `  [default: ${parameter.defaultValue}]` : ""}${parameter.help ? `  ${parameter.help}` : ""}`,
    )
    .join("\n");
  return `Usage: aps ${key} [OPTIONS]${argumentsText ? ` ${argumentsText}` : ""}\n\n${descriptions[key] ?? ""}\n${argumentDetails ? `\nArguments:\n${argumentDetails}\n` : ""}\nOptions:\n${optionsText}\n  --help  Show this message and exit.\n`;
}

type Completion = { value: string; help?: string };

function shortHelp(text: string): string {
  const words = text.split(/\s+/);
  let length = 0;
  for (let index = 0; index < words.length; index++) {
    length += words[index].length + (index > 0 ? 1 : 0);
    if (length > 45 || (length === 45 && index !== words.length - 1)) {
      length += 3;
      while (index > 0) {
        length -= words[index].length + 1;
        if (length <= 45) break;
        index--;
      }
      return `${words.slice(0, index).join(" ")}...`;
    }
    if (words[index].endsWith(".")) return words.slice(0, index + 1).join(" ");
  }
  return words.join(" ");
}

export function completionCandidates(
  args: string[],
  incomplete: string,
): Completion[] {
  const optionsHelp: Record<string, string> = {
    "--install-completion": "Install completion for the current shell.",
    "--show-completion":
      "Show completion for the current shell, to copy it or customize the installation.",
    "--root": "Studio root; overrides APS_STUDIO_ROOT and directory discovery.",
    "--help": "Show this message and exit.",
  };
  const options = (values: string[], pending?: string): Completion[] =>
    values
      .filter(
        (value) =>
          value.startsWith(incomplete) &&
          !(
            (value === "--yes" || value === "-y") &&
            args.some(
              (arg) =>
                arg === "-y" || arg === "--yes" || arg.startsWith("--yes="),
            )
          ) &&
          (value === pending ||
            !args.some((arg) => arg === value || arg.startsWith(`${value}=`))),
      )
      .map((value) => ({ value, help: optionsHelp[value] }));
  const subcommands = (values: string[], prefix = ""): Completion[] =>
    values
      .filter((value) => value.startsWith(incomplete))
      .map((value) => ({
        value,
        help: shortHelp(descriptions[`${prefix}${value}`]),
      }));
  if (!args.length) {
    const rootOptions = ["--install-completion", "--show-completion", "--help"];
    return incomplete.startsWith("-")
      ? options(rootOptions)
      : subcommands(commands);
  }
  const command = args[0];
  if (!commands.includes(command)) return completionCandidates([], incomplete);
  const group = groupFor(command);
  if (group && (args.length === 1 || !group.includes(args[1])))
    return incomplete.startsWith("-")
      ? options(["--help"])
      : subcommands(group, `${command} `);
  const length = group ? 2 : 1;
  const params = specFor(args.slice(0, length).join(" "));
  if (!params) return [];
  const parameters = params.filter((parameter) => !parameter.positional);
  for (const parameter of parameters)
    if (parameter.help) optionsHelp[`--${parameter.key}`] = parameter.help;
  if (command === "config") optionsHelp["-y"] = optionsHelp["--yes"];
  if (incomplete.startsWith("-")) {
    const last = args.at(-1);
    const pending = parameters.find(
      (parameter) => !parameter.flag && `--${parameter.key}` === last,
    );
    return options(
      [
        ...parameters.flatMap((parameter) =>
          command === "config" && parameter.key === "yes"
            ? ["--yes", "-y"]
            : [`--${parameter.key}`],
        ),
        "--help",
      ],
      pending ? last : undefined,
    );
  }
  const tail = args.slice(length);
  const positional: string[] = [];
  for (let index = 0; index < tail.length; index++) {
    const token = tail[index];
    if (token.startsWith("-")) {
      const optionName = token.split("=", 1)[0].replace(/^--/, "");
      const parameter = parameters.find((item) => item.key === optionName);
      if (parameter && !parameter.flag && !token.includes("=")) {
        if (index === tail.length - 1) return [];
        index++;
      }
    } else positional.push(token);
  }
  const parameter = params.filter((item) => item.positional)[positional.length];
  return (
    parameter?.choices
      ?.filter((choice) => choice.startsWith(incomplete))
      .map((value) => ({ value })) ?? []
  );
}

function label(parameter: Parameter): string {
  const text = parameter.key.replaceAll("-", " ");
  const title = text[0].toUpperCase() + text.slice(1);
  return parameter.positional ? title : `${title} (--${parameter.key})`;
}

async function promptParameter(
  prompts: Prompts,
  parameter: Parameter,
): Promise<string | boolean> {
  if (parameter.flag) return prompts.confirm(label(parameter), false);
  while (true) {
    const choices = parameter.choices
      ? ` (${parameter.choices.join(", ")})`
      : "";
    const value = await prompts.ask(
      `${label(parameter)}${choices}`,
      parameter.defaultValue,
      parameter.required,
    );
    if (!parameter.choices || parameter.choices.includes(value)) return value;
    console.log(
      `Error: '${value}' is not one of ${parameter.choices.join(", ")}.`,
    );
  }
}

async function menu(
  prompts: Prompts,
  prefix: string,
  names: string[],
): Promise<string | null> {
  console.log(`\n${prefix}: choose a command`);
  const commandPrefix = prefix === "aps" ? "" : `${prefix.slice(4)} `;
  names.forEach((name, index) =>
    console.log(
      `  ${index + 1}. ${name} - ${shortHelp(descriptions[`${commandPrefix}${name}`])}`,
    ),
  );
  console.log("  0. Exit");
  while (true) {
    const selection = await prompts.ask("Command", undefined, true);
    if (["0", "q", "quit", "exit"].includes(selection.toLowerCase()))
      return null;
    if (names.includes(selection)) return selection;
    if (
      /^\d+$/.test(selection) &&
      Number(selection) > 0 &&
      Number(selection) <= names.length
    )
      return names[Number(selection) - 1];
    console.log("Error: Choose a command name or its number, or 0 to exit.");
  }
}

export async function prepareInteractive(
  args: string[],
  getPrompts: () => Prompts,
): Promise<string[] | null> {
  if (!process.stdin.isTTY || requestsHelp(args)) return args;
  args = [...args];
  let guided = false;
  if (!args.length) {
    const selected = await menu(getPrompts(), "aps", commands);
    if (!selected) return null;
    args.push(selected);
    guided = true;
  }
  const group = groupFor(args[0]);
  if (group && args.length === 1) {
    const selected = await menu(getPrompts(), `aps ${args[0]}`, group);
    if (!selected) return null;
    args.push(selected);
    guided = true;
  }
  const length = group ? 2 : 1;
  const parameters = specFor(args.slice(0, length).join(" "));
  if (!parameters) return args;
  const tail = args.slice(length);
  const options = new Map(
    parameters
      .filter((parameter) => !parameter.positional)
      .map((parameter) => [`--${parameter.key}`, parameter]),
  );
  if (args[0] === "config") options.set("-y", options.get("--yes")!);
  if (guided && !tail.length) {
    for (const parameter of parameters) {
      const value = await promptParameter(getPrompts(), parameter);
      if (parameter.positional) tail.push(String(value));
      else if (parameter.flag) {
        if (value) tail.push(`--${parameter.key}`);
      } else if (value !== "") tail.push(`--${parameter.key}`, String(value));
    }
    return [...args.slice(0, length), ...tail];
  }
  const positionals: string[] = [];
  const incomplete: { index: number; parameter: Parameter }[] = [];
  const present = new Set<string>();
  for (let index = 0; index < tail.length; index++) {
    const token = tail[index];
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    const [key, inline] = token.split("=", 2);
    const parameter = options.get(key);
    if (!parameter) return args;
    present.add(parameter.key);
    if (!parameter.flag && inline === undefined) {
      if (index + 1 >= tail.length || tail[index + 1].startsWith("--"))
        incomplete.push({ index, parameter });
      else index++;
    }
  }
  const positionalSpecs = parameters.filter(
    (parameter) => parameter.positional,
  );
  for (
    let index = positionals.length;
    index < positionalSpecs.length;
    index++
  ) {
    const parameter = positionalSpecs[index];
    if (parameter.required)
      tail.push(String(await promptParameter(getPrompts(), parameter)));
  }
  for (const item of incomplete.reverse()) {
    const value = String(await promptParameter(getPrompts(), item.parameter));
    if (value === "" && !item.parameter.required) tail.splice(item.index, 1);
    else tail.splice(item.index + 1, 0, value);
  }
  for (const parameter of parameters) {
    if (
      !parameter.positional &&
      parameter.required &&
      !present.has(parameter.key)
    )
      tail.push(
        `--${parameter.key}`,
        String(await promptParameter(getPrompts(), parameter)),
      );
  }
  return [...args.slice(0, length), ...tail];
}
