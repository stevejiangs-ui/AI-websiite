/* 自洽校验：只抓「跑错周期」这类硬错误。
   正常年际间隔在 365.2422 ± 0.01 天之间浮动（地球轨道偏心率导致，
   折合 ±15 分钟，属真实天文现象）。真正可疑的是整小时级偏移。 */
import { termMoment, fmtBeijing, TERM_NAMES } from '../src/astro.js';

const DAY = 86400000;
const TROPICAL = 365.24219;

const rows = [];
for (let i = 0; i < 24; i += 1) {
  const lon = i * 15;
  for (let y = 1901; y <= 2100; y += 1) {
    const gap = (termMoment(y, lon).getTime() - termMoment(y - 1, lon).getTime()) / DAY;
    const errMin = (gap - TROPICAL) * 24 * 60;
    if (Math.abs(errMin) > 20) {
      rows.push({ term: TERM_NAMES[i], y, gap: +gap.toFixed(4), errMin: +errMin.toFixed(0), at: fmtBeijing(termMoment(y, lon).getTime()) });
    }
  }
}

console.log('检查 24 节气 × 200 年 =', 24 * 200, '个年际间隔');
console.log('整小时级异常（>20 分钟）:', rows.length, '个');
if (rows.length) {
  const byYear = {};
  rows.forEach((b) => (byYear[b.y] = (byYear[b.y] || 0) + 1));
  console.log('涉及年份:', Object.keys(byYear).join(' ') || '无');
  rows.slice(0, 30).forEach((b) => console.log(` ${b.term.padEnd(2)} ${b.y} 间隔 ${b.gap} 天 偏差 ${b.errMin} 分 → ${b.at}`));
}
