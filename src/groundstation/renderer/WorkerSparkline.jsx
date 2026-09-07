import React from "react";

/* ===========================================================================
   WorkerSparkline — lightweight canvas sparkline for live metric data

   Accepts a `values` prop (number[], newest last, max 60 points) and a
   `threshold` prop (fraction 0–1) above which the line shifts to amber,
   then to red above 0.9.

   No external charting library. Pure Canvas 2D with device-pixel-ratio
   awareness for sharp rendering on HiDPI screens.
   ======================================================================== */

const COLORS = {
  ok: "rgba(79, 157, 255, 0.9)",        // --mc-accent
  okFill: "rgba(79, 157, 255, 0.12)",
  warn: "rgba(234, 165, 68, 0.9)",      // --mc-warning
  warnFill: "rgba(234, 165, 68, 0.12)",
  danger: "rgba(255, 91, 102, 0.9)",    // --mc-danger
  dangerFill: "rgba(255, 91, 102, 0.1)",
  grid: "rgba(255, 255, 255, 0.04)",
};

function colorForValue(value, threshold = 0.7) {
  if (value >= 0.9) return { line: COLORS.danger, fill: COLORS.dangerFill };
  if (value >= threshold) return { line: COLORS.warn, fill: COLORS.warnFill };
  return { line: COLORS.ok, fill: COLORS.okFill };
}

function drawSparkline(canvas, values, threshold, maxValue, tone) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (!values || values.length < 2) return;

  const max = Math.max(Number(maxValue) || 0, ...values, 0.001);
  const norm = values.map(v => v / max);
  const step = w / (norm.length - 1);

  // Draw subtle horizontal grid lines
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  [0.25, 0.5, 0.75].forEach(frac => {
    const y = h - frac * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  // Determine peak color from latest value
  const latest = values[values.length - 1];
  const latestFrac = latest / max;
  const palette = tone && COLORS[tone] ? {
    line: COLORS[tone],
    fill: COLORS[`${tone}Fill`]
  } : colorForValue(latestFrac, threshold);
  const { line: lineColor, fill: fillColor } = palette;

  // Build smooth bezier path
  ctx.beginPath();
  ctx.moveTo(0, h - norm[0] * h * 0.85);
  for (let i = 1; i < norm.length; i++) {
    const x1 = (i - 1) * step;
    const x2 = i * step;
    const y1 = h - norm[i - 1] * h * 0.85;
    const y2 = h - norm[i] * h * 0.85;
    const cpx = (x1 + x2) / 2;
    ctx.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
  }

  // Fill gradient under the curve
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, fillColor);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw the sparkline itself
  ctx.beginPath();
  ctx.moveTo(0, h - norm[0] * h * 0.85);
  for (let i = 1; i < norm.length; i++) {
    const x1 = (i - 1) * step;
    const x2 = i * step;
    const y1 = h - norm[i - 1] * h * 0.85;
    const y2 = h - norm[i] * h * 0.85;
    const cpx = (x1 + x2) / 2;
    ctx.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
  }
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // Draw the latest-value endpoint dot
  const lastX = (norm.length - 1) * step;
  const lastY = h - norm[norm.length - 1] * h * 0.85;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
}

export function WorkerSparkline({ values = [], threshold = 0.7, maxValue, tone: explicitTone, width = 80, height = 28, label = "", unit = "%" }) {
  const canvasRef = React.useRef(null);
  const frameRef = React.useRef(null);

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      drawSparkline(canvas, values, threshold, maxValue, explicitTone);
    });
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [values, threshold, maxValue, explicitTone]);

  const latest = values[values.length - 1];
  const scaleMax = Math.max(Number(maxValue) || 0, ...values, 0.001);
  const latestFrac = typeof latest === "number" ? latest / scaleMax : 0;
  const tone = explicitTone || (latestFrac >= 0.9 ? "danger" : latestFrac >= threshold ? "warn" : "ok");
  const displayValue = typeof latest === "number" ? (unit === "%" ? `${Math.round(latest)}%` : latest >= 1024 ? `${(latest / 1024).toFixed(1)}G` : `${Math.round(latest)}M`) : "—";

  return (
    <div className={`worker-sparkline sparkline-tone-${tone}`} style={{ width, position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height }}
        aria-hidden="true"
      />
      {label && (
        <div className="sparkline-label">
          <span>{label}</span>
          <strong>{displayValue}</strong>
        </div>
      )}
    </div>
  );
}

/* ===========================================================================
   useWorkerMetrics — accumulates rolling telemetry for one worker session.

   Returns `{ cpuHistory, memHistory, ioHistory }` arrays, each capped at
   MAX_POINTS. Feeds directly into <WorkerSparkline />.

   CPU and RAM come from `session.resources` (the engine's resourceSampler,
   surfaced on every session snapshot). I/O is optional: `resourceSampler.cjs`
   does not currently emit `ioKBs`, so the I/O sparkline only renders once the
   engine actually reports non-zero I/O.
   ======================================================================== */

const MAX_POINTS = 40;

export function useWorkerMetrics(session) {
  const [cpuHistory, setCpuHistory] = React.useState([0]);
  const [memHistory, setMemHistory] = React.useState([0]);
  const [ioHistory, setIoHistory] = React.useState([0]);

  React.useEffect(() => {
    if (!session) return;
    const resources = session.resources;
    if (!resources?.available) return;

    const cpu = typeof resources.cpuPercent === "number" ? resources.cpuPercent : 0;
    const mem = typeof resources.memoryMB === "number" ? resources.memoryMB : 0;
    const io = typeof resources.ioKBs === "number" ? resources.ioKBs : 0;

    setCpuHistory(prev => [...prev.slice(-(MAX_POINTS - 1)), cpu]);
    setMemHistory(prev => [...prev.slice(-(MAX_POINTS - 1)), mem]);
    setIoHistory(prev => [...prev.slice(-(MAX_POINTS - 1)), io]);
  }, [session?.resources?.cpuPercent, session?.resources?.memoryMB, session?.resources?.ioKBs, session]);

  return { cpuHistory, memHistory, ioHistory };
}

/* ===========================================================================
   WorkerMetricStrip — three sparklines in a horizontal strip for use in the
   Groundstation worker cards and the terminal pane header.
   ======================================================================== */

export function WorkerMetricStrip({ session, compact = false }) {
  const { cpuHistory, memHistory, ioHistory } = useWorkerMetrics(session);
  // Only render when the engine is actually sampling this worker — never a
  // strip of flat zeros.
  if (!session?.isAlive || !session.resources?.available) return null;
  const signals = new Set(session.health?.signals || []);
  const cpuTone = signals.has("high-cpu") ? "danger" : "ok";
  const memoryTone = signals.has("high-memory") ? "warn" : "ok";
  const hasIo = ioHistory.some(value => value > 0);

  return (
    <div className={`worker-metric-strip ${compact ? "is-compact" : ""}`} aria-label={`Live metrics for ${session.name}`}>
      <WorkerSparkline values={cpuHistory} maxValue={Math.max(100, ...cpuHistory)} tone={cpuTone} width={compact ? 56 : 80} height={compact ? 20 : 28} label={compact ? null : "CPU"} unit="%" />
      <WorkerSparkline values={memHistory} tone={memoryTone} width={compact ? 56 : 80} height={compact ? 20 : 28} label={compact ? null : "RAM"} unit="MB" />
      {!compact && hasIo && (
        <WorkerSparkline values={ioHistory} tone="ok" width={80} height={28} label="I/O" unit="KB/s" />
      )}
    </div>
  );
}
