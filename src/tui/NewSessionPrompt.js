import React from "react";
import { Box, Text, useInput } from "ink";
import TextInputPkg from "ink-text-input";
import { colors } from "./theme.js";
import { isEscapeInput } from "./input.js";

const TextInput = TextInputPkg.default || TextInputPkg;
const e = React.createElement;

const FIELDS = [
  { key: "id", label: "Session ID", hint: "letters, numbers, dots, dashes, underscores" },
  { key: "name", label: "Display name", hint: "shown in OUTARCH" },
  { key: "command", label: "Command", hint: "for example: npm run dev" },
  { key: "cwd", label: "Working directory", hint: "relative to the workspace file; default ." },
  { key: "autoStart", label: "Start automatically?", hint: "yes/no; Enter defaults to yes, no registers an idle session" }
];

function validateField(field, value) {
  const trimmed = value.trim();
  if (field.key === "cwd") return null;
  if (field.key === "autoStart" && trimmed && !/^(?:y|yes|n|no)$/i.test(trimmed)) {
    return "Enter yes or no";
  }
  if (!trimmed && field.key !== "autoStart") return `${field.label} is required`;
  if (field.key === "id" && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(trimmed)) {
    return "Use 1-64 letters, numbers, dots, dashes, or underscores";
  }
  return null;
}

export default function NewSessionPrompt({ onSubmit, onCancel }) {
  const [index, setIndex] = React.useState(0);
  const [values, setValues] = React.useState({ id: "", name: "", command: "", cwd: ".", autoStart: "" });
  const [error, setError] = React.useState("");
  const field = FIELDS[index];

  useInput((input, key) => {
    if (isEscapeInput(input, key)) onCancel();
  });

  const submitField = value => {
    const issue = validateField(field, value);
    if (issue) {
      setError(issue);
      return;
    }

    const fallback = field.key === "cwd" ? "." : "";
    const nextValues = { ...values, [field.key]: value.trim() || fallback };
    setValues(nextValues);
    setError("");
    if (index < FIELDS.length - 1) {
      setIndex(index + 1);
      return;
    }
    onSubmit({
      ...nextValues,
      autoStart: !/^(?:n|no)$/i.test(nextValues.autoStart)
    });
  };

  return e(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "cyan", padding: 1 },
    e(Text, { color: "cyan", bold: true }, "NEW SESSION"),
    e(Text, { color: colors.dim }, `Step ${index + 1} of ${FIELDS.length} · Esc cancels`),
    e(Text, null, ""),
    e(Text, { bold: true }, field.label),
    e(Text, { color: colors.dim }, field.hint),
    e(
      Box,
      null,
      e(Text, { color: "cyan" }, "> "),
      e(TextInput, {
        key: field.key,
        value: values[field.key],
        onChange: value => {
          setValues(current => ({ ...current, [field.key]: value }));
          if (error) setError("");
        },
        onSubmit: submitField,
        focus: true
      })
    ),
    error ? e(Text, { color: colors.failed }, error) : null
  );
}
