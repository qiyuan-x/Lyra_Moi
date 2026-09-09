export function appendPrompt(current: string, value: string): string {
  if (!value) return current;
  if (!current) return value;
  return `${current}${current.endsWith("\n") ? "" : "\n"}${value}`;
}
