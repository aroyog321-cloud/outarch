// What a worker runs, said the way a person would say it.
//
// The two-field Add terminal form (workerForm.buildShellLaunch) stores a start
// command wrapped in the shell that keeps the pane interactive:
//   powershell.exe -NoLogo -NoProfile -NoExit -Command <typed command>
//   bash -i -c "<typed command>; exec bash -i"
// Printing that verbatim put the shell's housekeeping flags in front of every
// worker ("powershell.exe -NoLogo -NoProfile -..."), truncated before the part
// the operator actually typed. This reverses the wrapper for display only; the
// stored command and arguments are never changed, and `full` keeps the exact
// command line for a tooltip.

const SHELL_NAMES = {
  powershell: "PowerShell",
  pwsh: "PowerShell",
  cmd: "Command Prompt",
  bash: "Bash",
  zsh: "Zsh",
  sh: "Shell",
  fish: "Fish"
};

// Flags that only set the shell up and say nothing about what runs.
const SETUP_FLAGS = new Set(["-nologo", "-noprofile", "-noexit", "-noninteractive", "-mta", "-sta", "-i", "-l", "--login", "--interactive", "/q", "/d"]);
// Setup flags that consume the next argument as their value.
const SETUP_FLAGS_WITH_VALUE = new Set(["-executionpolicy", "-windowstyle", "-inputformat", "-outputformat"]);
const COMMAND_FLAGS = new Set(["-command", "-c", "/c", "/k"]);

export function describeLaunch(command, args) {
  const list = Array.isArray(args) ? args.map(value => String(value)) : [];
  const executable = String(command || "").trim();
  const full = [executable, ...list].filter(Boolean).join(" ").trim();
  const base = executable.split(/[\\/]/).pop().replace(/\.exe$/i, "").toLowerCase();
  const shell = SHELL_NAMES[base] || null;
  if (!executable) return { label: "", runs: "", shell: null, full: "" };
  if (!shell) return { label: full, runs: full, shell: null, full };

  let index = 0;
  while (index < list.length) {
    const flag = list[index].toLowerCase();
    if (SETUP_FLAGS.has(flag)) { index += 1; continue; }
    if (SETUP_FLAGS_WITH_VALUE.has(flag)) { index += 2; continue; }
    break;
  }
  const rest = list.slice(index);
  if (!rest.length) return { label: shell, runs: "", shell, full };

  if (COMMAND_FLAGS.has(rest[0].toLowerCase()) && rest.length > 1) {
    const text = rest.slice(1).join(" ")
      // buildShellLaunch hands POSIX panes back to the shell afterwards.
      .replace(new RegExp(`;\\s*exec\\s+${base}\\s+-i\\s*$`), "")
      .trim();
    return text ? { label: text, runs: text, shell, full } : { label: shell, runs: "", shell, full };
  }
  // Anything else is not the form's wrapper: show it exactly as configured.
  return { label: full, runs: full, shell, full };
}
