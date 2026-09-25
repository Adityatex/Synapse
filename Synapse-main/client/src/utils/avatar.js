const AVATAR_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#F7B32B',
  '#7C3AED',
  '#10B981',
  '#F97316',
  '#EC4899',
  '#3B82F6',
  '#84CC16',
  '#EF4444',
  '#14B8A6',
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
    color: '#ffffff',
    boxShadow: `0 0 0 1px ${hexToRgba(color, 0.15)}`,
  };
}
