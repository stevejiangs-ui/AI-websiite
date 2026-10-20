/* 新功能的数据表还没建时的提示卡（WorkBuddy 版需要先建表） */
import { h } from './store.js';

export function setupCard(what) {
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, `「${what}」还差一步`),
    h(
      'div',
      { class: 'muted', style: 'line-height:1.9' },
      '这个新功能需要在云端新建一张数据表。请把项目里 ',
      h('code', {}, 'migrations/2026-10-21-health-signals.sql'),
      ' 发给 WorkBuddy，说一句「按这个文件建表，权限规则和 entries 表一样」，建好后刷新页面就能用。'
    ),
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:10px' }, '其它功能不受影响，照常使用。')
  );
}
