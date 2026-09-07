const locks = new Map<string, Promise<unknown>>();

/** Serialize credential replacement, deletion and OAuth completion for one profile. */
export async function withProviderCredentialLock<T>(profileId: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(profileId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  locks.set(profileId, current);
  try { return await current; }
  finally { if (locks.get(profileId) === current) locks.delete(profileId); }
}
