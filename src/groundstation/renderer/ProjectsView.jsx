import React from "react";

function timeAgo(timestamp) {
  if (!Number.isFinite(timestamp)) return "Not opened yet";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusLabel(project) {
  if (project.current) return "Active";
  if (project.status === "ready") return "Ready";
  if (project.status === "warning") return "Warnings";
  if (project.status === "missing") return "Missing";
  if (project.status === "invalid") return "Invalid";
  return "Setup needed";
}

export default function ProjectsView({ data, loading, onChoose, onOpen, onRemove }) {
  const projects = data?.projects || [];
  const [query, setQuery] = React.useState("");
  const visibleProjects = projects.filter(project => `${project.name} ${project.rootPath} ${statusLabel(project)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const firstOpenable = visibleProjects.find(project => !project.current && (project.status === "ready" || project.status === "warning"));
  return (
    <div className="projects-view">
      <section className="project-switcher-head">
        <div>
          <span className="eyebrow">PROJECT SWITCHER</span>
          <h1>Open a workspace</h1>
          <p>Terminals, agents, recipes, and project memory follow the selected root.</p>
        </div>
        <button type="button" className="primary-button" onClick={onChoose} disabled={loading}>
          {loading ? "Opening…" : "+ Open folder"}
        </button>
      </section>

      {data?.registryError && (
        <div className="notice notice-error project-registry-error" role="alert">
          Recent projects could not be saved: {data.registryError}
        </div>
      )}

      <section className="project-list-panel">
        <header className="project-search-row">
          <label><span className="sr-only">Search recent projects</span><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && firstOpenable) onOpen(firstOpenable); }} placeholder="Search name or path…" autoFocus/></label>
          <span className="project-count">{visibleProjects.length} of {projects.length}</span>
        </header>
        {visibleProjects.length ? (
          <div className="project-list" role="list">
            {visibleProjects.map(project => {
              const openable = project.status === "ready" || project.status === "warning";
              return (
                <article role="listitem" className={`project-row project-${project.status} ${project.current ? "is-current" : ""}`} key={project.id}>
                  <span className="project-mark">{project.name.slice(0, 2).toUpperCase()}</span>
                  <div className="project-row__body">
                    <strong>{project.name}</strong>
                    <code title={project.rootPath}>{project.rootPath}</code>
                    {/* The status chip already names the condition, so a note
                        here only earns its place when it says something the
                        chip does not. "Missing" beside "project folder is
                        missing" was the same fact twice in two registers. */}
                    {project.error && !project.error.toLowerCase().includes(statusLabel(project).toLowerCase())
                      && <em className="project-row__note">{project.error}</em>}
                  </div>
                  <span className={`project-state project-state-${project.current ? "current" : project.status}`}>{statusLabel(project)}<small>{timeAgo(project.lastOpenedAt)}</small></span>
                  <div className="project-row__actions">
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={project.current || !openable || loading}
                      onClick={() => onOpen(project)}
                    >
                      {project.current ? "Current project" : "Open"}
                    </button>
                    {!project.current && (
                      <button
                        type="button"
                        className="quiet-button danger-button"
                        disabled={loading}
                        onClick={() => onRemove(project)}
                      >
                        Forget
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state project-empty">
            <span>⊞</span>
            <strong>{projects.length ? "No matching projects" : "No recent projects"}</strong>
            <p>{projects.length ? "Try a different name or path." : "Choose any folder to create a local Mission Control workspace."}</p>
          </div>
        )}
      </section>
    </div>
  );
}
