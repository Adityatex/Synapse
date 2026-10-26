import { cssSafeLabel, readPresence } from '@synapse/room-doc';

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Black or white, whichever is readable on the person's colour (the palette has pale ones). */
function inkFor(hex: string): string {
  const [r, g, b] = channels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111827' : '#ffffff';
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Styles for the remote cursors and selections that y-monaco draws. y-monaco tags each
 * decoration with the awareness client id; this gives each client its person's colour and
 * a name flag. Colours come from the fixed palette and names are reduced to CSS-safe
 * characters (see readPresence and cssSafeLabel), so nothing a peer sends reaches the
 * stylesheet raw.
 */
export function remoteCursorCss(states: Map<number, unknown>, ownClientId: number): string {
  const rules: string[] = [];
  for (const [clientId, raw] of states) {
    if (clientId === ownClientId || !Number.isSafeInteger(clientId)) continue;
    const presence = readPresence(raw);
    if (!presence) continue;
    const { color, name } = presence.user;
    rules.push(
      `.yRemoteSelection-${clientId} { background-color: ${rgba(color, 0.25)}; }`,
      `.yRemoteSelectionHead-${clientId} { position: absolute; box-sizing: border-box; height: 100%; border-left: 2px solid ${color}; }`,
      `.yRemoteSelectionHead-${clientId}::after { content: ''; position: absolute; left: -4px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: ${color}; }`,
      `.yRemoteSelectionHead-${clientId}::before { content: "${cssSafeLabel(name)}"; position: absolute; left: -2px; bottom: 100%; z-index: 20; padding: 0 5px; border-radius: 3px 3px 3px 0; background: ${color}; color: ${inkFor(color)}; font: 600 10px/16px system-ui, sans-serif; white-space: nowrap; pointer-events: none; }`,
    );
  }
  return rules.join('\n');
}
