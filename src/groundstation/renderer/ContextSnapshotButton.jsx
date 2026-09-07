import React from "react";
import { missionApi } from "./missionApi.js";
import { useToast } from "./ToastSystem.jsx";

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

export default function ContextSnapshotButton({ className = "" }) {
  const [busy, setBusy] = React.useState(false);
  const { toast } = useToast();
  const copy = async () => {
    setBusy(true);
    try {
      const snapshot = await missionApi().request("context.snapshot", { includeOutput: false });
      await writeClipboard(JSON.stringify(snapshot, null, 2));
      toast.success("Bounded project context copied", { actionLabel: "Open evidence", action: () => document.querySelector("[data-nav-id='history']")?.click() });
    } catch (error) {
      toast.danger(error.message || String(error));
    } finally {
      setBusy(false);
    }
  };
  return <button type="button" className={className} disabled={busy} onClick={() => void copy()} title="Copy a structured, redacted project snapshot without terminal output">
    {busy ? "Copying…" : "Copy context"}
  </button>;
}
