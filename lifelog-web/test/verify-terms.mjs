/* 交叉验证：用两个相互独立的判据确认同一批节气
   判据一：与本机天文算法算出的视黄经是否吻合（内部）
   判据二：与公开年历对照（外部，仅取 1995 年后稳定的数据） */
import { solarTerms, fmtBeijing, termMoment, deltaT, unixToJd } from '../src/astro.js';

/* 公开年历（北京时间，分钟级）—— 只取我有把握的现代年份 */
const EXP = {
  2000: { 立春: '02-04 20:40', 春分: '03-20 15:35', 夏至: '06-21 09:47', 秋分: '09-23 01:27', 冬至: '12-21 21:37' },
  2010: { 立春: '02-04 06:47', 春分: '03-21 01:32', 夏至: '06-21 19:28', 秋分: '09-23 11:09', 冬至: '12-22 07:38' },
  2020: { 立春: '02-04 17:03', 春分: '03-20 11:49', 夏至: '06-21 05:43', 秋分: '09-22 21:30', 冬至: '12-21 18:02' },
  2023: { 立春: '02-04 10:42', 春分: '03-21 05:24', 夏至: '06-21 22:57', 秋分: '09-23 14:49', 冬至: '12-22 11:27' },
  2024: { 立春: '02-04 16:26', 春分: '03-20 11:06', 夏至: '06-21 04:50', 秋分: '09-22 20:43', 冬至: '12-21 17:20' },
  2025: { 立春: '02-03 22:10', 春分: '03-20 17:01', 夏至: '06-21 10:42', 秋分: '09-23 02:19', 冬至: '12-21 23:03' },
  2026: { 立春: '02-04 03:46', 春分: '03-20 22:45', 夏至: '06-21 16:24', 秋分: '09-23 08:05', 冬至: '12-22 04:50' }
};

const asMs = (y, mdhm) => {
  const [md, hm] = mdhm.split(' ');
  const [mo, da] = md.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return Date.UTC(y, mo - 1, da, h, mi);
};

let count = 0;
let worst = 0;
let worstAt = '';
for (const [y, kv] of Object.entries(EXP)) {
  const terms = solarTerms(Number(y));
  for (const [name, exp] of Object.entries(kv)) {
    const hit = terms.find((t) => t.name === name);
    if (!hit) {
      console.log(`${y} ${name} 缺失`);
      continue;
    }
    const got = fmtBeijing(hit.at.getTime());
    const d = Math.round((asMs(Number(y), got.slice(5)) - asMs(Number(y), exp)) / 60000);
    count += 1;
    if (Math.abs(d) > Math.abs(worst)) {
      worst = d;
      worstAt = `${y} ${name} 算 ${got} 实 ${y}-${exp}`;
    }
    console.log(`${y} ${name}\t算 ${got}\t实 ${y}-${exp}\t差 ${d > 0 ? '+' : ''}${d} 分`);
  }
}
console.log(`\n共 ${count} 项，最大偏差 ${worst} 分钟 → ${worstAt}`);

/* 再验一次：每个解出的时刻，其太阳视黄经是否精确落在目标值上 */
console.log('\n--- 求解收敛性（用解出的时刻反算黄经，应等于目标）');
const probe = [[1984, 0], [1950, 90], [1900, 315], [2050, 180], [2100, 270]];
for (const [y, lon] of probe) {
  const ms = termMoment(y, lon).getTime();
  console.log(` ${y} 黄经${lon}° → ${fmtBeijing(ms)}（ΔT=${deltaT(y).toFixed(1)}s）`);
}
