/**
 * How an agent reads in a picker: "Full name · username". Usernames are often
 * bare employee numbers (2700623), so the name is what an admin recognises; the
 * username stays beside it to tell two people of the same name apart.
 */
export const staffLabel = (u: { username: string; name?: string | null }) =>
  u.name?.trim() ? `${u.name.trim()} · ${u.username}` : u.username;

/** Typing matches either half of the label. */
export const staffMatches = (u: { username: string; name?: string | null }, q: string) => {
  const t = q.trim().toLowerCase();
  return u.username.toLowerCase().includes(t) || !!u.name?.toLowerCase().includes(t);
};
