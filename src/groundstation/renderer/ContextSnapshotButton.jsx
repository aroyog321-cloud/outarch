import React from "react";
import { missionApi } from "./missionApi.js";
import { useToast } from "./ToastSystem.jsx";
import { copyText } from "./clipboard.js";

export default function ContextSnapshotButton({ className = "" }) {
  const [busy, setBusy] = React.useState(false);
  const { toast } = useToast();
  const copy = async () => {
    setBusy(true);
    try {
      const snapshot = await missionApi().request("context.snapshot", { includeOutput: false });
      await copyText(JSON.stringify(snapshot, null, 2));
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
