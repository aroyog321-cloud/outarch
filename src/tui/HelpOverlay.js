import React from "react";
import { Box, Text } from "ink";
import { colors } from "./theme.js";

const e = React.createElement;

const GROUPS = [
  ["Navigate", ["j / k or arrows", "Move between sessions"], ["g", "Next session needing attention"], ["Enter", "Open read-only Tail"]],
  ["Operate", ["F", "Full Attach to the same PTY"], ["s / r", "Start or restart safely"], ["u", "Toggle automatic startup"], ["e", "Edit a stopped worker"], ["p", "Add a saved worker preset"], ["a", "Acknowledge attention"], ["c / n", "Create or rename"]],
  ["Protect", ["x", "Kill with confirmation"], ["d", "Remove with confirmation"], ["q", "Quit OUTARCH"]]
];

export default function HelpOverlay() {
  return e(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "cyan", padding: 1 },
    e(Text, { color: "cyan", bold: true }, "OUTARCH · KEYBOARD GUIDE"),
    e(Text, { color: colors.dim }, "One PTY per session. Tail observes; Full Attach interacts."),
    e(Text, null, ""),
    ...GROUPS.flatMap(([title, ...items]) => [
      e(Text, { key: `${title}-title`, color: "cyan", bold: true }, title.toUpperCase()),
      ...items.map(([keys, description]) =>
        e(
          Box,
          { key: `${title}-${keys}` },
          e(Text, { color: "yellow" }, `${keys.padEnd(18)} `),
          e(Text, null, description)
        )
      ),
      e(Text, { key: `${title}-space` }, "")
    ]),
    e(Text, { color: colors.dim }, "Esc, h, or ? closes this guide")
  );
}
