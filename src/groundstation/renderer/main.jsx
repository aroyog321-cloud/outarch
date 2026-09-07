import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@xterm/xterm/css/xterm.css";
import App from "./App.jsx";
import "./tokens.css";
import "./styles.css";
import "./uiFoundation.css";
import "./groundstation21.css";
import "./missionGraph.css";
import "./projectMemory.css";
import "./vscodeBridge.css";
import "./mcpGateway.css";
import "./agentSupervision.css";
import "./automationWorkflows.css";
import "./mobileCompanion.css";
import "./pluginPlatform.css";
import "./missionAi.css";
import "./workspaceRecipes2.css";
import "./premiumDesign.css";
// Feature-complete route styling retained below the authoritative shell layer.
// The redesign files that follow own navigation, responsive geometry and tokens.
import "./premiumV3.css";
// Authoritative redesign layer — loaded last, token-driven, no override war.
// See src/groundstation/renderer/redesign/README.md.
import "./redesign/tokens-bridge.css";
import "./redesign/base.css";
import "./redesign/workspace.css";
import "./redesign/screens.css";
// Density pass: page headers, meter strips, accent discipline, deck + pane
// header overflow, empty states. See redesign/README.md.
import "./redesign/cockpit.css";
// Shared primitives resolve last: trust, decisions, skeletons, live telemetry,
// status chips and desktop feedback all have one renderer-owned grammar.
import "./redesign/surfaces.css";

document.documentElement.lang = navigator.language || "en";

createRoot(document.getElementById("root")).render(
  // Groundstation effects own explicit IPC terminal subscriptions. React's
  // development-only StrictMode remount would open a second stream before the
  // asynchronous close request from the first mount reaches the main process.
  <App />
);
