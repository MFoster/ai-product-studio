import { statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { inventoryProduct } from "./assets.js";
import { configure } from "./configuration.js";
import { handleCompletion } from "./completion.js";
import {
  commandOptions,
  helpText,
  helpError,
  normalizeCommandBoundaries,
  positionalNames,
  prepareInteractive,
  requestsHelp,
} from "./interactive.js";
import { legacyInventory } from "./legacy-assets.js";
import { loadWorkflow, type WorkflowStage } from "./manifests.js";
import { buildPackages } from "./packages.js";
import { formatGeneral } from "./numbers.js";
import { expandUserPath, joinRoot, resolvePath as resolve } from "./paths.js";
import { Prompts } from "./prompts.js";
import { checkToolkit, syncToolkit } from "./toolkit.js";
import { check as registryCheck, sync as registrySync } from "./registry.js";
import { writeSchemas } from "./schemas.js";
import {
  createLine,
  createProduct,
  createVariant,
  initialize,
} from "./scaffolding.js";
import { capture, listProfiles } from "./slicer.js";
import { validateStudio } from "./validation.js";
import {
  advance,
  createRelease,
  printResult,
  workflowOrder,
} from "./workflow.js";

class UsageError extends Error {}
let prompts: Prompts | undefined;

function getPrompts(): Prompts {
  prompts ??= new Prompts();
  return prompts;
}

function isWorkflowStage(value: string): value is WorkflowStage {
  return workflowOrder.some((stage) => stage === value);
}

function isStudio(root: string): boolean {
  try {
    return statSync(path.join(root, "config/studio.yaml")).isFile();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return false;
    throw error;
  }
}

function studioRoot(explicit: string | undefined): string {
  if (explicit !== undefined) return resolve(explicit);
  const configured = process.env.APS_STUDIO_ROOT;
  if (configured) {
    const expanded = expandUserPath(configured);
    const root = resolve(expanded);
    if (!isStudio(root))
      throw new Error(`APS_STUDIO_ROOT is not a studio: ${root}`);
    return root;
  }
  let current = resolve(process.cwd());
  while (true) {
    if (isStudio(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        "Could not find AI Product Studio root; expected config/studio.yaml in this directory or a parent.",
      );
    }
    current = parent;
  }
}

async function run(args: string[]): Promise<void> {
  if (requestsHelp(args)) {
    const error = helpError(args);
    if (error) throw new UsageError(error);
    const help = helpText(args);
    if (help === null) throw new UsageError("No such command.");
    console.log(help);
    return;
  }
  if (args.length === 0) {
    console.log(helpText(["--help"]));
    process.exitCode = 2;
    return;
  }
  const command = args[0];
  const isInit = command === "init";
  const isConfig = command === "config";
  const isValidate = command === "validate";
  const isRegistry = command === "registry";
  const isToolkit = command === "toolkit";
  const isSchema = command === "schema";
  const isAssets = command === "assets";
  const isLegacyInventory = isAssets && args[1] === "legacy-inventory";
  const isWorkflow = command === "workflow";
  const isRelease = command === "release";
  const isSlicer = command === "slicer";
  if (
    !isInit &&
    ![
      "product-line",
      "variant",
      "product",
      "registry",
      "schema",
      "assets",
      "workflow",
      "release",
      "slicer",
      "validate",
      "config",
      "toolkit",
    ].includes(command)
  ) {
    throw new UsageError(
      command.startsWith("-")
        ? `No such option: ${command}`
        : `No such command '${command}'.`,
    );
  }
  if (!isInit && !isConfig && !isValidate && args.length === 1) {
    console.log(helpText([command, "--help"]));
    process.exitCode = 2;
    return;
  }
  if (
    !isInit &&
    !isValidate &&
    !isConfig &&
    (isRegistry || isToolkit
      ? !["sync", "check"].includes(args[1])
      : isSchema
        ? args[1] !== "write"
        : isWorkflow
          ? !["status", "advance", "print-result"].includes(args[1])
          : isRelease
            ? args[1] !== "create"
            : isSlicer
              ? !["capture", "list"].includes(args[1])
              : isAssets
                ? !["inventory", "package", "legacy-inventory"].includes(
                    args[1],
                  )
                : args[1] !== "create")
  ) {
    throw new UsageError(
      args[1].startsWith("-")
        ? `No such option: ${args[1]}`
        : `No such command '${args[1]}'.`,
    );
  }
  let parsed: ReturnType<typeof parseArgs>;
  const commandLength = isInit || isValidate || isConfig ? 1 : 2;
  const options = commandOptions(args.slice(0, commandLength));
  const optionArguments = args.slice(commandLength);
  const normalized: string[] = [];
  for (let index = 0; index < optionArguments.length; index++) {
    const option = optionArguments[index];
    if (option === "--") {
      normalized.push(...optionArguments.slice(index));
      break;
    }
    if (
      option.startsWith("--") &&
      options.get(option.slice(2)) === false &&
      optionArguments[index + 1]?.startsWith("-")
    )
      normalized.push(`${option}=${optionArguments[++index]}`);
    else normalized.push(option);
  }
  try {
    parsed = parseArgs({
      args: normalized,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(
        [...options].map(([key, flag]) => [
          key,
          {
            type: flag ? "boolean" : "string",
            ...(key === "yes" ? { short: "y" } : {}),
          },
        ]),
      ),
    });
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
        const option = /Unknown option '([^']+)'/.exec(error.message)?.[1];
        if (option) throw new UsageError(`No such option: ${option}`);
      }
      if (error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
        const flag = /Option '([^']+)' does not take an argument/.exec(
          error.message,
        )?.[1];
        if (flag)
          throw new UsageError(
            `Option '${flag.split(", ").at(-1)}' does not take a value.`,
          );
        const option = /Option '([^' ]+)(?: <value>)?' argument missing/.exec(
          error.message,
        )?.[1];
        if (option)
          throw new UsageError(`Option '${option}' requires an argument.`);
      }
    }
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const { values, positionals } = parsed;
  const count = isInit
    ? 1
    : isConfig
      ? 0
      : isValidate
        ? 0
        : isWorkflow
          ? args[1] === "status"
            ? 1
            : 2
          : isRelease
            ? 2
            : isSlicer
              ? args[1] === "capture"
                ? 2
                : 1
              : isAssets
                ? 1
                : isRegistry || isToolkit || isSchema
                  ? 0
                  : command === "product-line"
                    ? 1
                    : command === "variant"
                      ? 2
                      : 3;
  if (!isInit && positionals.length < count) {
    const names = positionalNames(
      args.slice(0, isConfig || isValidate ? 1 : 2),
    );
    throw new UsageError(`Missing argument '${names[positionals.length]}'.`);
  }
  if (isWorkflow && args[1] === "advance" && !isWorkflowStage(positionals[1]))
    throw new UsageError(
      `Invalid value for 'stage': '${positionals[1]}' is not one of ${workflowOrder.map((stage) => `'${stage}'`).join(", ")}.`,
    );
  if (positionals.length > count)
    throw new UsageError(
      `Got unexpected extra argument(s) (${positionals.slice(count).join(" ")})`,
    );
  const name = values.name;
  if (
    !isInit &&
    !isConfig &&
    !isValidate &&
    !isRegistry &&
    !isToolkit &&
    !isSchema &&
    !isAssets &&
    !isWorkflow &&
    !isRelease &&
    !isSlicer &&
    typeof name !== "string"
  )
    throw new UsageError("Missing option '--name'.");
  const scaffoldOptions = {
    force: values.force === true,
    dryRun: values["dry-run"] === true,
  };
  if (isRelease && typeof values.approval !== "string")
    throw new UsageError("Missing option '--approval'.");
  if (isWorkflow && args[1] === "advance") {
    if (typeof values.note !== "string")
      throw new UsageError("Missing option '--note'.");
  }
  if (
    isWorkflow &&
    args[1] === "print-result" &&
    typeof values.evidence !== "string"
  )
    throw new UsageError("Missing option '--evidence'.");
  if (isInit) {
    const target = initialize(
      resolve(positionals[0] ?? "."),
      typeof name === "string" ? name : "AI Product Studio",
      scaffoldOptions,
    );
    console.log(
      `${scaffoldOptions.dryRun ? "Would initialize" : "Initialized"} ${target}`,
    );
    return;
  }
  const root = studioRoot(
    typeof values.root === "string" ? values.root : undefined,
  );
  if (isConfig) {
    await configure(root, values.yes === true, getPrompts());
    return;
  }
  if (isValidate) {
    const errors = await validateStudio(root);
    if (errors.length) {
      for (const error of errors) console.error(`ERROR ${error}`);
      process.exitCode = 1;
    } else {
      console.log("Studio validation passed");
    }
    return;
  }
  if (isSlicer) {
    const productDir = resolve(joinRoot(root, positionals[0]));
    if (args[1] === "capture") {
      const project = resolve(joinRoot(root, positionals[1]));
      const { profile, file } = await capture(productDir, project, {
        slug: typeof values.slug === "string" ? values.slug : undefined,
        name: typeof values.name === "string" ? values.name : undefined,
        note: typeof values.note === "string" ? values.note : undefined,
        force: values.force === true,
      });
      console.log(`Captured slice profile ${profile.slug} -> ${file}`);
      console.log(
        `${profile.printer_model || "unknown printer"}; ${profile.print_settings_id || "unknown preset"}; ${formatGeneral(profile.layer_height_mm)} mm layers on a ${formatGeneral(profile.nozzle_diameter_mm)} mm nozzle`,
      );
    } else {
      const profiles = listProfiles(productDir);
      if (!profiles.length) console.log("No slice profiles recorded");
      for (const profile of profiles)
        console.log(
          `${profile.slug} [${profile.evidence}] ${profile.print_settings_id || profile.name}; layer=${formatGeneral(profile.layer_height_mm)} mm; walls=${profile.wall_loops}; infill=${profile.sparse_infill_density || "unknown"}`,
        );
    }
    return;
  }
  if (isAssets && !isLegacyInventory) {
    const productDir = resolve(joinRoot(root, positionals[0]));
    if (args[1] === "package") {
      const packages = await buildPackages(
        root,
        productDir,
        typeof values.group === "string" ? values.group : undefined,
      );
      for (const file of packages) console.log(file);
      console.log(
        `Built ${packages.length} group packages; run aps assets inventory next.`,
      );
    } else {
      console.log(`Inventoried ${await inventoryProduct(productDir)} assets`);
    }
    return;
  }
  if (isWorkflow || isRelease) {
    const productDir = resolve(joinRoot(root, positionals[0]));
    if (isRelease) {
      if (typeof values.approval !== "string")
        throw new Error("Missing required approval");
      const destination = createRelease(
        productDir,
        positionals[1],
        values.approval,
        typeof values.notes === "string" ? values.notes : "",
      );
      console.log(`Created immutable release manifest ${destination}`);
    } else if (args[1] === "status") {
      const workflow = loadWorkflow(productDir);
      console.log(
        `${workflow.product}: ${workflow.current_stage}; print=${workflow.physical_print_status}; blockers=${workflow.blockers.length}`,
      );
    } else if (args[1] === "advance") {
      if (typeof values.note !== "string" || !isWorkflowStage(positionals[1]))
        throw new Error("Invalid workflow advance arguments");
      const workflow = advance(
        productDir,
        positionals[1],
        values.note,
        typeof values.approval === "string" ? values.approval : undefined,
      );
      console.log(`Advanced ${workflow.product} to ${workflow.current_stage}`);
    } else {
      if (typeof values.evidence !== "string")
        throw new Error("Missing required evidence");
      const workflow = printResult(productDir, positionals[1], values.evidence);
      console.log(
        `Recorded physical print status: ${workflow.physical_print_status}`,
      );
    }
    return;
  }
  if (isLegacyInventory) {
    const output =
      typeof values.output === "string"
        ? values.output
        : "report/legacy-assets.yaml";
    const destination = joinRoot(root, output);
    const count = legacyInventory(positionals[0], destination);
    console.log(`Inventoried ${count} unmanaged assets`);
    return;
  }
  if (isSchema) {
    console.log(`Wrote ${writeSchemas(root)} schemas`);
    return;
  }
  if (isToolkit) {
    if (args[1] === "sync") {
      const count = syncToolkit(
        root,
        scaffoldOptions.dryRun,
        undefined,
        (line) => console.log(line),
      );
      console.log(
        `${scaffoldOptions.dryRun ? "Would synchronize" : "Synchronized"} ${count} toolkit capabilities`,
      );
    } else {
      const errors = checkToolkit(root);
      if (errors.length) {
        for (const error of errors) console.error(`ERROR ${error}`);
        process.exitCode = 1;
      } else console.log("Toolkit is synchronized");
    }
    return;
  }
  if (isRegistry) {
    if (args[1] === "sync") {
      const count = registrySync(root, scaffoldOptions.dryRun);
      console.log(
        `${scaffoldOptions.dryRun ? "Would synchronize" : "Synchronized"} ${count} entries`,
      );
    } else {
      const errors = registryCheck(root);
      if (errors.length) {
        for (const error of errors) console.error(`ERROR ${error}`);
        process.exitCode = 1;
      } else {
        console.log("Registry is synchronized");
      }
    }
    return;
  }
  const displayName = name as string;
  const target =
    command === "product-line"
      ? createLine(
          root,
          positionals[0],
          displayName,
          String(values.description ?? ""),
          scaffoldOptions,
        )
      : command === "variant"
        ? createVariant(
            root,
            positionals[0],
            positionals[1],
            displayName,
            String(values.theme ?? ""),
            scaffoldOptions,
          )
        : createProduct(
            root,
            positionals[0],
            positionals[1],
            positionals[2],
            displayName,
            String(values.summary ?? ""),
            scaffoldOptions,
          );
  console.log(
    `${scaffoldOptions.dryRun ? "Would create" : "Created"} ${target}`,
  );
}

try {
  const rawArgs = normalizeCommandBoundaries(process.argv.slice(2));
  if (!handleCompletion(rawArgs)) {
    const args = await prepareInteractive(rawArgs, getPrompts);
    if (args) await run(args);
  }
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = error instanceof UsageError ? 2 : 1;
} finally {
  prompts?.close();
}
