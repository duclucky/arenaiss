export function agentDisplayName(label: string): string {
  return label.replace(/ · [0-9a-f]{12}$/i, '');
}
