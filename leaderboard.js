// Sample participants and registered users share the same score-based ranking.
export function buildLeaderboard(entries = [], currentUser = null, period = 'week') {
  const participants = new Map();
  for (const entry of entries) {
    if (!entry.username) continue;
    participants.set(entry.username, { ...entry, is_demo: false, is_current: entry.username === currentUser?.username });
  }
  if (currentUser?.username && !participants.has(currentUser.username)) {
    participants.set(currentUser.username, {
      username: currentUser.username, name: currentUser.name,
      points: period === 'all' ? Number(currentUser.points) || 0 : 0,
      completed_count: 0, correct_count: 0, is_demo: false, is_current: true,
    });
  }
  const multiplier = period === 'all' ? 3 : period === 'month' ? 2 : 1;
  const demo = [
    { username: 'demo-alesya', name: 'Алеся К.', points: 1040 * multiplier, completed_count: 18 * multiplier },
    { username: 'demo-mikola', name: 'Микола Д.', points: 930 * multiplier, completed_count: 16 * multiplier },
    { username: 'demo-darya', name: 'Дарья С.', points: 870 * multiplier, completed_count: 15 * multiplier },
  ].map((entry) => ({ ...entry, correct_count: 0, is_demo: true, is_current: false }));
  return [...demo, ...participants.values()].sort((a, b) =>
    b.points - a.points || b.correct_count - a.correct_count ||
    Number(b.is_current) - Number(a.is_current) || a.username.localeCompare(b.username, 'ru'));
}
