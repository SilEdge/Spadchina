import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeaderboard } from '../leaderboard.js';

test('demo leaders stay on the podium while real results are sorted below', () => {
  const entries = [
    { username: 'beta', name: 'Бета', points: 60, correct_count: 2, completed_count: 1 },
    { username: 'alpha', name: 'Альфа', points: 5000, correct_count: 5, completed_count: 3 },
  ];
  const ranking = buildLeaderboard(entries, entries[0], 'week');
  assert.equal(ranking.length, 5);
  assert.ok(ranking.slice(0, 3).every((entry) => entry.is_demo));
  assert.ok(ranking[2].points > ranking[3].points);
  assert.equal(ranking[3].username, 'alpha');
  assert.equal(ranking[4].username, 'beta');
  assert.equal(ranking[4].points, 60);
  assert.equal(ranking[4].is_current, true);
  assert.equal(entries[0].is_current, undefined);
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
