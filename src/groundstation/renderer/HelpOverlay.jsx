import React from "react";
import * as Dialog from "@radix-ui/react-dialog";

const GROUPS = [
  ["Navigate", [["Alt G", "Groundstation"], ["Alt W", "Workspace"], ["Alt N", "Needs You"], ["Alt A", "Agents"], ["Alt H", "History"]]],
  ["Operate", [["Ctrl K", "Mission Command"], ["N", "Create a worker"], ["? / F1", "Keyboard help"], ["Esc", "Close the active layer"]]],
  ["Workers", [["Enter", "Open selected worker"], ["Hold Space", "Quick Look"], ["Double-click", "Focus worker or terminal"], ["Drag", "Move a worker between panes"]]],
  ["Groundstation manifest", [["↑ ↓", "Move through the manifest"], ["Ctrl F", "Search name or command"], ["Ctrl Shift R", "Restart or start the selection"], ["Ctrl Shift S", "Stop the selection (confirmed)"], ["Ctrl Shift F", "Pin the selection to the top"], ["Esc", "Clear the selection"]]],
  ["Terminal canvas", [["Alt 1–6", "Focus a pane"], ["Alt ← ↑ → ↓", "Move focus between panes"], ["Alt L", "Cycle canvas layout"], ["Alt F", "Focus mode — every terminal, no chrome"], ["Alt B", "OUTARCH browser"], ["Ctrl F", "Search the active terminal"]]],
  ["Resize terminals", [["Drag an edge", "Resize that terminal; its neighbours give way"], ["Drag a corner", "Resize width and height at once"], ["Arrow keys", "On a focused edge, resize by 24px"], ["Double-click", "On an edge, even out the sizes"], ["Esc", "Put a dragged terminal back"], ["Inspector", "Show structured engine facts"]]]
];

export default function HelpOverlay({ open, onClose }) {
  return <Dialog.Root open={open} onOpenChange={value => !value && onClose()}><Dialog.Portal>
    <Dialog.Overlay className="palette-backdrop help-backdrop"/>
    <Dialog.Content className="help-dialog" aria-describedby={undefined}>
      <header><div><span className="section-kicker">KEYBOARD-FIRST WORKSTATION</span><Dialog.Title>OUTARCH shortcuts</Dialog.Title></div><Dialog.Close asChild><button aria-label="Close keyboard help">×</button></Dialog.Close></header>
      <div className="help-groups">{GROUPS.map(([label, shortcuts]) => <section key={label}><span>{label.toUpperCase()}</span><dl>{shortcuts.map(([keys, description]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{description}</dd></div>)}</dl></section>)}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
