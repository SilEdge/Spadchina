import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeaderboard } from '../leaderboard.js';

test('880 points take third place and move Darya with 870 points to fourth', () => {
  const me = { username: 'me', name: 'Мой профиль', points: 880, correct_count: 10, completed_count: 2 };
  const ranking = buildLeaderboard([me], me, 'week');
  assert.deepEqual(ranking.map((entry) => entry.username), ['demo-alesya', 'demo-mikola', 'me', 'demo-darya']);
  assert.equal(ranking[2].points, 880);
  assert.equal(ranking[2].is_current, true);
  assert.equal(ranking[3].points, 870);
  assert.equal(ranking[3].completed_count, 15);
  assert.equal(buildLeaderboard([{ ...me, points: 869 }], me, 'week')[2].username, 'demo-darya');
});

test('real users can take first place without increasing sample participants scores', () => {
  const entries = [
    { username: 'beta', name: 'Бета', points: 60, correct_count: 2, completed_count: 1 },
    { username: 'alpha', name: 'Альфа', points: 5000, correct_count: 5, completed_count: 3 },
  ];
  const ranking = buildLeaderboard(entries, entries[0], 'week');
  assert.equal(ranking.length, 5);
  assert.equal(ranking[0].username, 'alpha');
  assert.deepEqual(ranking.slice(1, 4).map((entry) => entry.points), [1040, 930, 870]);
  assert.equal(ranking[4].username, 'beta');
  assert.equal(ranking[4].points, 60);
  assert.equal(ranking[4].is_current, true);
  assert.equal(entries[0].is_current, undefined);
});

test('three real leaders displace every sample participant from the podium', () => {
  const players = [5000, 4000, 3300].map((points, index) => ({ username: `player-${index}`, points, correct_count: 0 }));
  const ranking = buildLeaderboard(players, null, 'all');
  assert.deepEqual(ranking.slice(0, 3).map((entry) => entry.username), ['player-0', 'player-1', 'player-2']);
  const weekly = buildLeaderboard(players, null, 'week');
  assert.ok(weekly.slice(0, 3).every((entry) => !entry.is_demo));
  assert.ok(weekly.slice(3).every((entry) => Number.isFinite(entry.completed_count)));
});

test('current user appears fourth on tied zero scores without duplicate or fake points', () => {
  const me = { username: 'me', name: 'Мой профиль', points: 0 };
  const entry = { ...me, correct_count: 0, completed_count: 0 };
  const ranking = buildLeaderboard([{ username: 'other', points: 0, correct_count: 0 }, entry], me, 'all');
  assert.equal(ranking[3].username, 'me');
  assert.equal(ranking.filter((item) => item.username === 'me').length, 1);
  assert.equal(ranking[3].points, 0);
  assert.equal(buildLeaderboard([], me, 'month')[3].username, 'me');
});
