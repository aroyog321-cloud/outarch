export const RECIPE_TEMPLATES = Object.freeze([
  { id: "sequential", label: "Ordered stack", detail: "One worker unlocks the next" },
  { id: "parallel", label: "Parallel services", detail: "All workers can start together" },
  { id: "verify", label: "Start then verify", detail: "Services first, last worker verifies" }
]);

export function applyRecipeTemplate(templateId, steps) {
  const clean = steps.map(step => ({ ...step, dependsOn: [] }));
  if (templateId === "custom") return steps.map(step => ({ ...step, dependsOn: [...step.dependsOn] }));
  if (templateId === "parallel") return clean;
  if (templateId === "verify") {
    if (clean.length < 2) return clean;
    return clean.map((step, index) => index === clean.length - 1
      ? { ...step, dependsOn: clean.slice(0, -1).map(candidate => candidate.workerId) }
      : { ...step, dependsOn: [] });
  }
  return clean.map((step, index) => ({ ...step, dependsOn: index ? [clean[index - 1].workerId] : [] }));
}

// The template a saved graph was built from, or "custom" when its order was set
// worker by worker. A saved recipe used to reopen with no strategy chosen.
export function matchRecipeTemplate(steps) {
  if (!Array.isArray(steps) || !steps.length) return "custom";
  const sameSet = (left, right) => left.length === right.length && left.every(value => right.includes(value));
  for (const template of RECIPE_TEMPLATES) {
    const expected = applyRecipeTemplate(template.id, steps);
    if (expected.every((step, index) => sameSet(step.dependsOn, steps[index].dependsOn || []))) return template.id;
  }
  return "custom";
}

export function toggleStepDependency(steps, workerId, dependencyId) {
  return steps.map(step => {
    if (step.workerId !== workerId) return { ...step, dependsOn: [...step.dependsOn] };
    const dependsOn = step.dependsOn.includes(dependencyId)
      ? step.dependsOn.filter(value => value !== dependencyId)
      : [...step.dependsOn, dependencyId];
    return { ...step, dependsOn };
  });
}

export function dependencyCycle(steps) {
  const remaining = new Map(steps.map(step => [step.workerId, new Set(step.dependsOn)]));
  const ready = [...remaining].filter(([, dependencies]) => dependencies.size === 0).map(([workerId]) => workerId);
  while (ready.length) {
    const workerId = ready.shift();
    if (!remaining.has(workerId)) continue;
    remaining.delete(workerId);
    for (const [candidate, dependencies] of remaining) {
      dependencies.delete(workerId);
      if (dependencies.size === 0) ready.push(candidate);
    }
  }
  return [...remaining.keys()];
}
