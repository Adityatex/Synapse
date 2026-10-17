// Light, slightly muted tones that sit on the dark green ground and carry
// dark ink. Yellow is left out: it belongs to the primary action.
const AVATAR_COLORS = [
  '#7dd3fc',
  '#9fe0bb',
  '#e8c6a0',
  '#c8b6ff',
  '#f4a6a6',
  '#8fd3c8',
  '#d9c27a',
  '#b5c99a',
  '#f2b8d8',
  '#a8c5ff',
];

function hexToRgba(color, alpha) {
  const normalized = String(color || '').replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;

  const red = parseInt(expanded.slice(0, 2), 16);
  const green = parseInt(expanded.slice(2, 4), 16);
  const blue = parseInt(expanded.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function hashSeed(seed = '') {
  return Array.from(String(seed)).reduce(
    (accumulator, character, index) => accumulator + character.charCodeAt(0) * (index + 1),
    0
  );
}

export function getUserInitial(userLike) {
  const value =
    userLike?.name ||
    userLike?.username ||
    userLike?.email ||
    (typeof userLike === 'string' ? userLike : '') ||
    'U';

  return String(value).trim().charAt(0).toUpperCase() || 'U';
}

export function getAvatarColor(userLike, preferredColor) {
  if (preferredColor) {
    return preferredColor;
  }

  const seed =
    userLike?.userId ||
    userLike?.id ||
    userLike?.email ||
    userLike?.username ||
    userLike?.name ||
    String(userLike || 'user');

  return AVATAR_COLORS[hashSeed(seed) % AVATAR_COLORS.length];
}

export function getAvatarStyle(userLike, preferredColor) {
  const color = getAvatarColor(userLike, preferredColor);

  return {
    backgroundColor: color,
    borderColor: hexToRgba(color, 0.35),
    color: '#0d2a1c',
  };
}
