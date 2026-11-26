import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { completionCandidates } from "./interactive.js";

type Shell = "bash" | "zsh" | "fish" | "powershell" | "pwsh";
const shells = new Set(["bash", "zsh", "fish", "powershell", "pwsh"]);
const detectableShells = new Set([
  "sh",
  "bash",
  "dash",
  "ash",
  "csh",
  "tcsh",
  "ksh",
  "zsh",
  "fish",
  "cmd",
  "powershell",
  "pwsh",
  "elvish",
  "xonsh",
  "nu",
]);

function script(shell: Shell, program: string, variable: string): string {
  const fn = `_${program.replaceAll("-", "_").replace(/[^a-zA-Z0-9_]/g, "")}_completion`;
  if (shell === "bash")
    return `${fn}() {
    local IFS=$'
'
    COMPREPLY=( $( env COMP_WORDS="\${COMP_WORDS[*]}" \\
                   COMP_CWORD=$COMP_CWORD \\
                   ${variable}=complete_bash $1 ) )
    return 0
}

complete -o default -F ${fn} ${program}`;
  if (shell === "zsh")
    return `#compdef ${program}

${fn}() {
  eval $(env _TYPER_COMPLETE_ARGS="\${words[1,$CURRENT]}" ${variable}=complete_zsh ${program})
}

compdef ${fn} ${program}`;
  if (shell === "fish")
    return `complete --command ${program} --no-files --arguments "(env ${variable}=complete_fish _TYPER_COMPLETE_FISH_ACTION=get-args _TYPER_COMPLETE_ARGS=(commandline -cp) ${program})" --condition "env ${variable}=complete_fish _TYPER_COMPLETE_FISH_ACTION=is-args _TYPER_COMPLETE_ARGS=(commandline -cp) ${program}"`;
  return `Import-Module PSReadLine
Set-PSReadLineKeyHandler -Chord Tab -Function MenuComplete
$scriptblock = {
    param($wordToComplete, $commandAst, $cursorPosition)
    $Env:${variable} = "complete_powershell"
    $Env:_TYPER_COMPLETE_ARGS = $commandAst.ToString()
    $Env:_TYPER_COMPLETE_WORD_TO_COMPLETE = $wordToComplete
    ${program} | ForEach-Object {
        $commandArray = $_ -Split ":::"
        $command = $commandArray[0]
        $helpString = $commandArray[1]
        [System.Management.Automation.CompletionResult]::new(
            $command, $command, 'ParameterValue', $helpString)
    }
    $Env:${variable} = ""
    $Env:_TYPER_COMPLETE_ARGS = ""
    $Env:_TYPER_COMPLETE_WORD_TO_COMPLETE = ""
}
Register-ArgumentCompleter -Native -CommandName ${program} -ScriptBlock $scriptblock`;
}

function words(value: string): string[] {
  const result: string[] = [];
  let word = "";
  let quote = "";
  let escaped = false;
  let started = false;
  for (const char of value) {
    if (escaped) {
      word += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else word += char;
      started = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) result.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (escaped) word += "\\";
  if (started) result.push(word);
  return result;
}

function shellName(command: string, args: string[]): string | undefined {
  if (command.startsWith("-"))
    return path.basename(process.env.SHELL || command.slice(1)).toLowerCase();
  const name = path.basename(command).toLowerCase();
  if (detectableShells.has(name)) return name;
  if (/^python(?:\d+(?:\.\d+)?)?$/.test(name)) {
    for (const arg of args) {
      if (path.basename(arg).toLowerCase() !== "xonsh") continue;
      try {
        if (statSync(arg).isFile()) return "xonsh";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          !["ENOENT", "ENOTDIR"].includes(String(error.code))
        )
          throw error;
      }
    }
  }
  return undefined;
}

export function windowsShell(
  data: unknown,
  initialPid: number,
): string | undefined {
  const entries = Array.isArray(data) ? data : [data];
  const processes = new Map<number, { parent: number; name: string }>();
  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("ProcessId" in entry) ||
      !("ParentProcessId" in entry) ||
      !("Name" in entry) ||
      typeof entry.ProcessId !== "number" ||
      typeof entry.ParentProcessId !== "number" ||
      typeof entry.Name !== "string"
    )
      throw new Error("Invalid Windows process information.");
    processes.set(entry.ProcessId, {
      parent: entry.ParentProcessId,
      name: entry.Name.replace(/\.exe$/i, "").toLowerCase(),
    });
  }
  let pid = initialPid;
  for (let depth = 0; depth <= 10 && pid > 0; depth++) {
    const processInfo = processes.get(pid);
    if (!processInfo) return undefined;
    if (detectableShells.has(processInfo.name)) return processInfo.name;
    pid = processInfo.parent;
  }
  return undefined;
}

function detectShell(): string | undefined {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Could not inspect Windows processes: ${result.stderr.trim() || `exit ${result.status}`}`,
      );
    return windowsShell(JSON.parse(result.stdout), process.pid);
  }
  if (existsSync("/proc/self/stat")) {
    let pid = process.pid;
    for (let depth = 0; depth < 10 && pid > 0; depth++) {
      try {
        const [command, ...args] = readFileSync(
          `/proc/${pid}/cmdline`,
          "utf8",
        ).split("\0");
        const shell = shellName(command, args);
        if (shell) return shell;
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const parent = /^\d+ \(.+\) \S+ (\d+)/.exec(stat);
        if (!parent) return undefined;
        pid = Number(parent[1]);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          ["ENOENT", "EACCES", "ESRCH"].includes(String(error.code))
        )
          return undefined;
        throw error;
      }
    }
    return undefined;
  }
  const result = spawnSync(
    "ps",
    ["-ww", "-o", "pid=", "-o", "ppid=", "-o", "args="],
    {
      encoding: "utf8",
    },
  );
  if (result.error) {
    if ("code" in result.error && result.error.code === "ENOENT")
      return undefined;
    throw result.error;
  }
  if (result.status !== 0) {
    if (result.stdout.trim())
      throw new Error(
        `Could not inspect shell processes: ${result.stderr.trim() || `exit ${result.status}`}`,
      );
    return undefined;
  }
  const processes = new Map<number, { parent: number; args: string[] }>();
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match)
      processes.set(Number(match[1]), {
        parent: Number(match[2]),
        args: match[3].split(" ").map((arg) => arg.trim()),
      });
  }
  let pid = process.pid;
  for (let depth = 0; depth < 10 && pid > 0; depth++) {
    const processInfo = processes.get(pid);
    if (!processInfo) return undefined;
    const [command, ...args] = processInfo.args;
    const shell = shellName(command, args);
    if (shell) return shell;
    pid = processInfo.parent;
  }
  return undefined;
}

function install(shell: Shell, program: string, content: string): string {
  const home = os.homedir();
  if (shell === "powershell" || shell === "pwsh") {
    const policy = spawnSync(
      shell,
      [
        "-Command",
        "Set-ExecutionPolicy",
        "Unrestricted",
        "-Scope",
        "CurrentUser",
      ],
      { stdio: "inherit" },
    );
    if (policy.error) throw policy.error;
    if (policy.status !== 0)
      console.error(
        `Warning: PowerShell execution policy was not changed (exit ${policy.status}).`,
      );
    const result = spawnSync(
      shell,
      ["-NoProfile", "-Command", "echo", "$profile"],
      { encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Could not get PowerShell user profile: ${result.stderr.trim() || `exit ${result.status}`}`,
      );
    const file = result.stdout.trim();
    if (!path.isAbsolute(file))
      throw new Error("PowerShell returned an invalid user profile path.");
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${content}\n`);
    return file;
  }
  if (shell === "bash" && /['\r\n]/.test(home))
    throw new Error(
      "Cannot safely install Bash completion into this home directory.",
    );
  let file: string;
  if (shell === "bash") {
    file = path.join(home, ".bash_completions", `${program}.sh`);
    const rc = path.join(home, ".bashrc");
    let existing = existsSync(rc) ? readFileSync(rc, "utf8") : "";
    const source = `source '${file}'`;
    if (!existing.includes(source)) existing += `\n${source}`;
    writeFileSync(rc, `${existing}\n`);
  } else if (shell === "zsh") {
    file = path.join(home, ".zfunc", `_${program}`);
    const rc = path.join(home, ".zshrc");
    let existing = existsSync(rc) ? readFileSync(rc, "utf8") : "";
    const init = "fpath+=~/.zfunc; autoload -Uz compinit; compinit";
    if (!existing.includes(init)) existing += `\n${init}\n`;
    if (!existing.includes("zstyle"))
      existing += "\nzstyle ':completion:*' menu select\n";
    writeFileSync(rc, `${existing.trim()}\n`);
  } else {
    file = path.join(home, ".config/fish/completions", `${program}.fish`);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, shell === "fish" ? `${content}\n` : content);
  return file;
}

export function handleCompletion(args: string[]): boolean {
  const program = path.basename(process.argv[1] ?? "aps").replace(/\.js$/, "");
  const variable = `_${program.replaceAll("-", "_").toUpperCase()}_COMPLETE`;
  const instruction = process.env[variable];
  if (
    !instruction &&
    args[0] !== "--show-completion" &&
    args[0] !== "--install-completion"
  )
    return false;
  if (!/^[a-zA-Z0-9_.-]+$/.test(program))
    throw new Error(
      "Cannot safely use this executable name for shell completion.",
    );
  if (instruction) {
    const [action, shellName] = instruction.split("_", 2);
    if (!shells.has(shellName))
      throw new Error(`Shell ${shellName ?? ""} not supported.`);
    const shell = shellName as Shell;
    if (action === "source") console.log(script(shell, program, variable));
    else if (action === "complete") {
      const source =
        shell === "bash"
          ? (process.env.COMP_WORDS ?? "")
          : (process.env._TYPER_COMPLETE_ARGS ?? "");
      const split = words(source);
      const index =
        shell === "bash"
          ? Number(process.env.COMP_CWORD ?? split.length)
          : split.length - (source.endsWith(" ") ? 0 : 1);
      const incomplete =
        shell === "powershell" || shell === "pwsh"
          ? (process.env._TYPER_COMPLETE_WORD_TO_COMPLETE ?? "")
          : (split[index] ?? "");
      const matches = completionCandidates(split.slice(1, index), incomplete);
      if (
        shell === "fish" &&
        process.env._TYPER_COMPLETE_FISH_ACTION === "is-args"
      ) {
        process.exitCode = matches.length ? 0 : 1;
      } else if (shell === "zsh") {
        const escape = (text: string) =>
          text
            .replaceAll('"', '""')
            .replaceAll("'", "''")
            .replaceAll("$", "\\$")
            .replaceAll("`", "\\`")
            .replaceAll(":", "\\\\:");
        console.log(
          matches.length
            ? `_arguments '*: :((${matches.map((item) => `"${escape(item.value)}"${item.help ? `:"${escape(item.help)}"` : ""}`).join("\n")}))'`
            : "_files",
        );
      } else if (shell === "powershell" || shell === "pwsh") {
        console.log(
          matches
            .map((item) => `${item.value}:::${item.help ?? " "}`)
            .join("\n"),
        );
      } else if (shell === "fish") {
        console.log(
          matches
            .map((item) => `${item.value}${item.help ? `\t${item.help}` : ""}`)
            .join("\n"),
        );
      } else console.log(matches.map((item) => item.value).join("\n"));
    } else throw new Error(`Completion instruction "${action}" not supported.`);
    return true;
  }
  const explicit = process.env._TYPER_COMPLETE_TEST_DISABLE_SHELL_DETECTION
    ? args[1]
    : undefined;
  const name = explicit ?? detectShell() ?? "";
  if (!shells.has(name)) throw new Error(`Shell ${name} not supported.`);
  const shell = name as Shell;
  const content = script(shell, program, variable);
  if (args[0] === "--show-completion") console.log(content);
  else {
    const file = install(shell, program, content);
    console.log(
      `${explicit ? `Shells.${shell}` : shell} completion installed in ${file}`,
    );
    console.log("Completion will take effect once you restart the terminal");
  }
  return true;
}
