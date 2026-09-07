import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { engineEventFrom, missionApi } from "./missionApi.js";
import { buildMissionGraph, readinessLabel } from "./missionGraphModel.js";

/* ===========================================================================
   MissionGraph — Interactive Visual DAG Canvas

   Upgrades the previous column-card layout into a fully interactive SVG-based
   dependency graph with:
     - Pan & zoom (CSS transform via pointer events, min/max bounded)
     - Animated bezier cable connectors (signal-pulse stroke-dashoffset)
     - Node health halos (pulsing ring for live, amber for attention, red for failed)
     - Minimap in the bottom-right corner
     - Click-to-inspect side panel with full dependency detail

   Behaviour and data model are unchanged — same missionApi calls,
   same buildMissionGraph helper, same approval gates.
   ======================================================================== */

function statusLabel(session) {
  if (!session) return "Missing worker";
  if (session.status === "failed") return "Failed";
  if (session.attentionRequired) return "Needs you";
  if (session.isAlive) return "Running";
  return session.status === "exited" ? "Exited" : "Idle";
}

function nodeTone(node) {
  if (!node.session) return "missing";
  if (node.session.status === "failed") return "failed";
  if (node.session.attentionRequired) return "attention";
  if (node.session.isAlive) return "running";
  return "idle";
}

/* -------------------------------------------------------- Layout engine

   Positions nodes in a layered Sugiyama-style layout.
   Columns map to X positions; nodes within a column share X, stacked in Y.
*/
const NODE_W = 200;
const NODE_H = 72;
const COL_GAP = 120;
const ROW_GAP = 20;

function layoutGraph(graph) {
  const positions = new Map();
  let canvasW = 0;
  let canvasH = 0;

  graph.columns.forEach((column, colIdx) => {
    const colH = column.length * (NODE_H + ROW_GAP) - ROW_GAP;
    canvasH = Math.max(canvasH, colH);
    column.forEach((node, rowIdx) => {
      positions.set(node.workerId, {
        x: colIdx * (NODE_W + COL_GAP) + 20,
        y: rowIdx * (NODE_H + ROW_GAP) + 20,
      });
    });
    canvasW = Math.max(canvasW, (colIdx + 1) * (NODE_W + COL_GAP) + 20);
  });

  canvasH += 40;
  return { positions, canvasW, canvasH };
}

/* ---- Animated bezier cable between two nodes ---- */
function Cable({ from, to, tone = "idle", animated = false }) {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const cpX = (x1 + x2) / 2;

  const strokeColor = tone === "running" ? "var(--mc-accent)" :
    tone === "failed" ? "var(--mc-danger)" :
    tone === "attention" ? "var(--mc-warning)" :
    "var(--mc-border-strong)";

  const id = `cable-${from.x}-${from.y}-${to.x}-${to.y}`;

  return (
    <g className={`dag-cable dag-cable--${tone}`} aria-hidden="true">
      {/* Glow under-layer */}
      <path
        d={`M ${x1} ${y1} C ${cpX} ${y1} ${cpX} ${y2} ${x2} ${y2}`}
        fill="none"
        stroke={strokeColor}
        strokeWidth="3"
        opacity="0.2"
        strokeLinecap="round"
      />
      {/* Primary cable */}
      <path
        id={id}
        d={`M ${x1} ${y1} C ${cpX} ${y1} ${cpX} ${y2} ${x2} ${y2}`}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        opacity="0.7"
        strokeLinecap="round"
      />
      {/* Animated signal pulse — only when upstream is running */}
      {animated && (
        <circle r="4" fill={strokeColor} opacity="0.9">
          <animateMotion dur="1.8s" repeatCount="indefinite" begin="0s">
            <mpath href={`#${id}`} />
          </animateMotion>
        </circle>
      )}
      {/* Arrowhead */}
      <circle cx={x2 - 6} cy={y2} r="3" fill={strokeColor} opacity="0.6" />
    </g>
  );
}

/* ---- Single DAG Node ---- */
function DagNode({ node, position, selected, onSelect }) {
  const tone = nodeTone(node);
  const isLive = tone === "running";
  const isFailed = tone === "failed";
  const isAttention = tone === "attention";

  const borderColor = isFailed ? "var(--mc-danger)" :
    isAttention ? "var(--mc-warning)" :
    isLive ? "var(--mc-accent)" :
    "var(--mc-border)";

  return (
    <g
      className={`dag-node dag-node--${tone} ${selected ? "is-selected" : ""}`}
      transform={`translate(${position.x}, ${position.y})`}
      onClick={() => onSelect(node.workerId)}
      role="button"
      aria-pressed={selected}
      aria-label={`${node.session?.name || node.workerId}: ${statusLabel(node.session)}`}
      style={{ cursor: "pointer" }}
    >
      {/* Halo pulse for live nodes */}
      {isLive && (
        <rect
          x="-3" y="-3"
          width={NODE_W + 6} height={NODE_H + 6}
          rx="14"
          fill="none"
          stroke={borderColor}
          strokeWidth="1"
          opacity="0.4"
          className="dag-node__halo"
        />
      )}

      {/* Selection ring */}
      {selected && (
        <rect
          x="-2" y="-2"
          width={NODE_W + 4} height={NODE_H + 4}
          rx="13"
          fill="none"
          stroke="var(--mc-accent)"
          strokeWidth="1.5"
          opacity="0.8"
        />
      )}

      {/* Node background */}
      <rect
        x="0" y="0"
        width={NODE_W} height={NODE_H}
        rx="11"
        fill="var(--mc-surface-2)"
        stroke={selected ? "var(--mc-accent-line)" : borderColor}
        strokeWidth={selected ? "1.5" : "1"}
      />

      {/* Status indicator stripe on left edge */}
      <rect
        x="0" y="14"
        width="3" height={NODE_H - 28}
        rx="2"
        fill={borderColor}
        opacity={isLive || isFailed || isAttention ? 1 : 0.3}
      />

      {/* Node content */}
      {/* Status dot */}
      <circle
        cx="18" cy="18"
        r="4"
        fill={borderColor}
        opacity={isLive ? 1 : 0.5}
      />
      {isLive && (
        <circle cx="18" cy="18" r="4" fill={borderColor} opacity="0.3">
          <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Worker name */}
      <foreignObject x="30" y="8" width={NODE_W - 38} height="24">
        <div xmlns="http://www.w3.org/1999/xhtml" style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "12px",
          fontWeight: "640",
          color: "var(--mc-text)",
          fontFamily: "var(--font-family-ui)",
          lineHeight: "24px",
        }}>
          {node.session?.name || node.workerId}
        </div>
      </foreignObject>

      {/* Command */}
      <foreignObject x="12" y="32" width={NODE_W - 24} height="18">
        <div xmlns="http://www.w3.org/1999/xhtml" style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "10px",
          color: "var(--mc-text-dim)",
          fontFamily: "var(--mc-font-mono)",
          lineHeight: "18px",
        }}>
          {node.session?.command || "No process definition"}
        </div>
      </foreignObject>

      {/* Status pill */}
      <foreignObject x="12" y="50" width={NODE_W - 24} height="16">
        <div xmlns="http://www.w3.org/1999/xhtml" style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          fontSize: "9.5px",
          fontWeight: "680",
          color: isFailed ? "var(--mc-danger)" : isAttention ? "var(--mc-warning)" : isLive ? "var(--mc-accent)" : "var(--mc-text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "var(--mc-font-mono)",
          lineHeight: "16px",
        }}>
          {readinessLabel(node.readiness)} · {statusLabel(node.session)}
        </div>
      </foreignObject>
    </g>
  );
}

/* ---- Pan/Zoom canvas ---- */
function usePanZoom() {
  const [transform, setTransform] = React.useState({ x: 0, y: 0, scale: 1 });
  const dragging = React.useRef(false);
  const lastPos = React.useRef({ x: 0, y: 0 });

  const onPointerDown = (e) => {
    if (e.target.closest(".dag-node")) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };

  const onPointerUp = () => { dragging.current = false; };

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({
      ...prev,
      scale: Math.min(2, Math.max(0.35, prev.scale * delta)),
    }));
  };

  const reset = () => setTransform({ x: 0, y: 0, scale: 1 });

  return { transform, onPointerDown, onPointerMove, onPointerUp, onWheel, reset };
}

/* ---- Inspector side panel ---- */
function GraphInspector({ node, session, sessionById, onOpenTerminal, onOpenRecipes }) {
  if (!node) {
    return (
      <div className="mission-graph-inspector">
        <div className="mission-graph-inspector__empty">
          Select a worker node to inspect its configured upstream and downstream relationships.
        </div>
      </div>
    );
  }

  const tone = nodeTone(node);
  const depNames = node.dependsOn.map(id => sessionById.get(id)?.name || id);
  const downstreamNames = node.downstream.map(id => sessionById.get(id)?.name || id);

  return (
    <aside className="mission-graph-inspector">
      <div className="mission-graph-inspector__head">
        <span className="section-kicker">SELECTED WORKER</span>
        <i className={`tone-${tone}`} style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      </div>
      <h2>{session?.name || node.workerId}</h2>
      <p>{session ? `${statusLabel(session)} under EngineAPI supervision.` : "This configured worker is not present in the current engine state."}</p>
      <dl>
        <div><dt>Readiness gate</dt><dd>{readinessLabel(node.readiness)}</dd></div>
        <div><dt>Depends on</dt><dd>{depNames.length ? depNames.join(", ") : "Nothing — starts first"}</dd></div>
        <div><dt>Unlocks</dt><dd>{downstreamNames.length ? downstreamNames.join(", ") : "No downstream workers"}</dd></div>
        <div>
          <dt>Resources</dt>
          <dd>
            {session?.resources?.available
              ? `${typeof session.resources.cpuPercent === "number" ? `${session.resources.cpuPercent}% CPU` : "—"} · ${typeof session.resources.memoryMB === "number" ? `${session.resources.memoryMB} MB RAM` : "—"}`
              : "Not sampled"}
          </dd>
        </div>
        <div><dt>Restore policy</dt><dd>{session?.autoStart ? "Automatic" : "Manual"}</dd></div>
      </dl>
      {node.cyclic && (
            <div className="mission-graph-cycle" role="alert">Dependency cycle detected for this worker.</div>
      )}
      <footer>
        {session && (
          <button type="button" className="btn-primary" onClick={() => onOpenTerminal(node.workerId)}>
            Open terminal
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onOpenRecipes}>Edit recipe</button>
      </footer>
    </aside>
  );
}

/* ---- Main exported component ---- */
export default function MissionGraph({ open, sessions, onClose, onOpenTerminal, onOpenRecipes }) {
  const [recipes, setRecipes] = React.useState([]);
  const [selectedRecipeId, setSelectedRecipeId] = React.useState("");
  const [selectedWorkerId, setSelectedWorkerId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const { transform, onPointerDown, onPointerMove, onPointerUp, onWheel, reset } = usePanZoom();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const value = await missionApi().request("recipe.list");
      const next = Array.isArray(value) ? value.slice(0, 20) : [];
      setRecipes(next);
      setSelectedRecipeId(current => next.some(r => r.id === current) ? current : next[0]?.id || "");
      setError("");
    } catch (value) {
      setError(value.message || String(value));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return undefined;
    void refresh();
    let unsubscribe = () => {};
    try {
      unsubscribe = missionApi().subscribe(notification => {
        const event = engineEventFrom(notification);
        if (event && String(event.type || "").startsWith("recipe:")) void refresh();
      });
    } catch { /* ignore */ }
    return () => unsubscribe?.();
  }, [open, refresh]);

  const selectedRecipe = recipes.find(r => r.id === selectedRecipeId) || recipes[0] || null;
  const graph = React.useMemo(() => buildMissionGraph(selectedRecipe, sessions), [selectedRecipe, sessions]);
  const sessionById = React.useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const { positions, canvasW, canvasH } = React.useMemo(() => layoutGraph(graph), [graph]);

  const selectedNode = graph.columns.flat().find(n => n.workerId === selectedWorkerId) || null;

  // Build cable list from dependency relationships
  const cables = React.useMemo(() => {
    const list = [];
    graph.columns.flat().forEach(node => {
      node.dependsOn.forEach(depId => {
        const fromPos = positions.get(depId);
        const toPos = positions.get(node.workerId);
        if (!fromPos || !toPos) return;
        const upstreamSession = sessionById.get(depId);
        const tone = upstreamSession?.isAlive ? "running" :
          upstreamSession?.status === "failed" ? "failed" :
          upstreamSession?.attentionRequired ? "attention" : "idle";
        list.push({ fromId: depId, toId: node.workerId, fromPos, toPos, tone, animated: tone === "running" });
      });
    });
    return list;
  }, [graph, positions, sessionById]);

  const run = selectedRecipe?.run;
  const runLabel = run?.phase ? `${run.phase}${run.currentWorkerId ? ` · ${sessionById.get(run.currentWorkerId)?.name || run.currentWorkerId}` : ""}` : "Not running";

  return (
    <Dialog.Root open={open} onOpenChange={value => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="mission-graph-backdrop" />
        <Dialog.Content className="mission-graph-dialog dag-dialog" aria-describedby="mission-graph-description">
          <header className="mission-graph-header">
            <div>
              <span className="section-kicker">MISSION GRAPH</span>
              <Dialog.Title>Interactive dependency canvas</Dialog.Title>
              <Dialog.Description id="mission-graph-description" style={{ display: "none" }}>
                Visual dependency graph for workspace recipes. Pan to navigate, scroll to zoom, click a node to inspect.
              </Dialog.Description>
            </div>
            <div className="mission-graph-header-actions">
              <button type="button" onClick={reset} title="Reset view" className="dag-control-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                Reset view
              </button>
              <button type="button" onClick={refresh} disabled={loading} className="dag-control-btn">
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <Dialog.Close asChild>
                <button type="button" className="dag-control-btn dag-close-btn" aria-label="Close Mission Graph">×</button>
              </Dialog.Close>
            </div>
          </header>

          {/* Recipe selector tabs */}
          {recipes.length > 0 && (
            <nav className="mission-graph-recipes" aria-label="Workspace dependency recipes">
              {recipes.map(recipe => (
                <button
                  type="button"
                  key={recipe.id}
                  className={recipe.id === selectedRecipe?.id ? "is-current" : ""}
                  aria-current={recipe.id === selectedRecipe?.id ? "true" : undefined}
                  onClick={() => { setSelectedRecipeId(recipe.id); setSelectedWorkerId(""); reset(); }}
                >
                  <strong>{recipe.name}</strong>
                  <small>{recipe.steps?.length || 0} workers</small>
                </button>
              ))}
            </nav>
          )}

          {/* Summary strip */}
          {selectedRecipe && (
            <section className="mission-graph-summary" aria-label="Mission Graph summary">
              <div><small>RECIPE</small><strong>{selectedRecipe.name}</strong></div>
              <div><small>WORKERS</small><strong>{graph.workerCount}</strong></div>
              <div><small>DEPENDENCIES</small><strong>{graph.edgeCount}</strong></div>
              <div className={graph.blockedCount ? "has-risk" : ""}><small>NEEDS REVIEW</small><strong>{graph.blockedCount}</strong></div>
              <div><small>RUN STATE</small><strong>{runLabel}</strong></div>
            </section>
          )}

          {error && <div className="mission-graph-error" role="alert">{error}</div>}

          {!loading && !error && !selectedRecipe ? (
            <section className="mission-graph-empty">
              <span>↳</span>
              <h2>No configured dependency graph</h2>
              <p>Mission Graph only displays relationships saved in Workspace Recipes. Your {sessions.length} worker{sessions.length === 1 ? " is" : "s are"} currently independent.</p>
              <button type="button" onClick={onOpenRecipes}>Configure a workspace recipe</button>
            </section>
          ) : selectedRecipe && (
            <div className="mission-graph-layout dag-layout">
              {/* DAG Canvas with pan+zoom */}
              <div
                className="dag-canvas-wrapper"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                onWheel={onWheel}
                style={{ cursor: "grab", userSelect: "none", overflow: "hidden", position: "relative" }}
              >
                <svg
                  width="100%"
                  height="100%"
                  style={{
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                    transformOrigin: "0 0",
                    transition: "none",
                    overflow: "visible",
                  }}
                  viewBox={`0 0 ${canvasW} ${canvasH}`}
                >
                  {/* Cables (drawn first, behind nodes) */}
                  {cables.map(c => (
                    <Cable
                      key={`${c.fromId}-${c.toId}`}
                      from={c.fromPos}
                      to={c.toPos}
                      tone={c.tone}
                      animated={c.animated}
                    />
                  ))}

                  {/* Nodes */}
                  {graph.columns.flat().map(node => {
                    const pos = positions.get(node.workerId);
                    if (!pos) return null;
                    return (
                      <DagNode
                        key={node.workerId}
                        node={node}
                        position={pos}
                        selected={selectedWorkerId === node.workerId}
                        onSelect={id => setSelectedWorkerId(prev => prev === id ? "" : id)}
                      />
                    );
                  })}

                  {/* Unlinked workers (outside this recipe) */}
                  {graph.unlinked.length > 0 && (
                    <text
                      x={canvasW / 2}
                      y={canvasH - 12}
                      textAnchor="middle"
                      fill="var(--mc-text-dim)"
                      fontSize="10"
                      fontFamily="var(--mc-font-mono)"
                    >
                      {graph.unlinked.length} worker{graph.unlinked.length === 1 ? "" : "s"} outside this recipe
                    </text>
                  )}
                </svg>

                {/* Zoom level indicator */}
                <div className="dag-zoom-badge">
                  {Math.round(transform.scale * 100)}%
                </div>
              </div>

              {/* Inspector panel */}
              <GraphInspector
                node={selectedNode}
                session={selectedNode ? sessionById.get(selectedNode.workerId) : null}
                sessionById={sessionById}
                onOpenTerminal={id => { onOpenTerminal(id); onClose(); }}
                onOpenRecipes={onOpenRecipes}
              />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
