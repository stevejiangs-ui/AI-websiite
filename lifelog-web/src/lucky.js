/* 从生辰八字推出「今天对我有利」的东西：喜用五行、幸运色、今日干支。
   给穿搭建议、今日建议用。没填生辰就返回 null。 */
import { state } from './store.js';
import { baziOf, dailyFortune } from './bazi.js';
import { favorableGods } from './yongshen.js';

let cache = { key: '', val: null };

export function luckyToday() {
  const b = state.birth;
  if (!b) return null;
  const day = new Date().toDateString();
  const key = JSON.stringify(b) + day;
  if (cache.key === key) return cache.val;
  let val = null;
  try {
    const chart = baziOf(b);
    const fg = favorableGods(chart);
    const f = dailyFortune(new Date());
    val = {
      dayMaster: chart.dayMaster,
      verdict: fg.verdict,
      useful: fg.useful.map((u) => u.wx),
      favorable: fg.favorable.map((u) => u.wx),
      avoid: fg.avoid.map((u) => u.wx),
      colors: [...new Set(fg.advice.colors)],
      dirs: [...new Set(fg.advice.dirs)],
      dayGz: f.dayGz,
      monthGz: f.monthGz,
      yearGz: f.yearGz
    };
  } catch (e) {
    val = null;
  }
  cache = { key, val };
  return val;
}

/** 给 AI 的一句话命理背景 */
export function luckyLine() {
  const l = luckyToday();
  if (!l) return '';
  return `命理参考：日主${l.dayMaster}，${l.verdict}；用神${l.useful.join('、')}${l.favorable.length ? '，喜神' + l.favorable.join('、') : ''}，忌${l.avoid.join('、')}；幸运色 ${l.colors.join('、')}；今天是${l.yearGz}年${l.monthGz}月${l.dayGz}日。`;
}
