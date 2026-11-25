import { icon } from '@fortawesome/fontawesome-svg-core';
import { faCrown, faGift, faImage, faPaw, faSeedling, faShield, faTree, faTrophy } from '@fortawesome/free-solid-svg-icons';

export const rewardIcons = [
  ['🏆', 'Кубок', faTrophy],
  ['🖼', 'Рамка', faImage],
  ['🌲', 'Дерево', faTree],
  ['🦬', 'След животного', faPaw],
  ['🌼', 'Росток', faSeedling],
  ['👑', 'Корона', faCrown],
  ['🛡', 'Щит', faShield],
  ['🎁', 'Подарок', faGift],
];

export function renderRewardIcon(value) {
  const key = String(value ?? '').replace(/\uFE0F/g, '');
  const definition = rewardIcons.find(([candidate]) => candidate === key)?.[2] || faGift;
  return icon(definition).html.join('');
}

