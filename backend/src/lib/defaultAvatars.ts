// Keys must match filenames in backend/public/default-avatars/*.svg
export const DEFAULT_AVATAR_KEYS = [
  "panda",
  "fox",
  "owl",
  "cat",
  "dog",
  "rabbit",
  "koala",
  "lion",
  "penguin",
  "tiger",
] as const;

export type DefaultAvatarKey = (typeof DEFAULT_AVATAR_KEYS)[number];

export function isDefaultAvatarKey(key: string): key is DefaultAvatarKey {
  return (DEFAULT_AVATAR_KEYS as readonly string[]).includes(key);
}

export function randomDefaultAvatarKey(): DefaultAvatarKey {
  return DEFAULT_AVATAR_KEYS[Math.floor(Math.random() * DEFAULT_AVATAR_KEYS.length)];
}

export function defaultAvatarUrl(key: DefaultAvatarKey): string {
  return `/default-avatars/${key}.svg`;
}
