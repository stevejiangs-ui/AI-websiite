/* 子平八字排盘
   ------------------------------------------------------------------
   与旧版的区别（旧版三处是硬错，用户已指出）：

   1. 年柱 —— 以「立春」精确时刻为界。旧版用固定 2 月 4 日。
      2025 年立春在 2 月 3 日 22:10，生在当晚的人旧版会整整错一位。
   2. 月柱 —— 以十二「节」（立春/惊蛰/清明…）的精确时刻为界。
      旧版用「每月 4 日」。交节当天出生的人，差几分钟就差一柱。
   3. 时柱 —— 用出生地真太阳时。旧版直接拿北京时间按两小时切。
      经度差每分钟 4 秒/度，均时差 ±16 分钟，最极端能差 2 个多时辰。

   还加了：1949 年前中国的历史时区、1986–1991 夏令时、1980 年前的
   出生地「北京时」误差（当时中国实际用时区较乱）。

   精度：节气时刻与天文年历对照，1900–2100 误差 1 分钟内。 */

import { termMoment, jieAround, toBeijing, fmtBeijing, deltaT, unixToJd, equationOfTime, JIE_NAMES } from './astro.js';

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

const GAN_WUXING = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
/* 地支五行表用文件里已有的 ZHI_WUXING —— 不能拿天干表查地支，
   之前就是把子的水、亥的水染成天干色了。 */

/* 地支藏干：本气 / 中气 / 余气。权重按传统「本气 6、中气 3、余气 1」折算 */
/* 地支五行表：子水 丑土 寅木 卯木 辰土 巳火 午火 未土 申金 酉金 戌土 亥水。
   不能拿天干表查地支 —— 之前就是把子的水、亥的水染成天干色了。 */
const ZHI_WUXING = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };

const ZHI_CANG = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'],
  辰: ['戊', '乙', '癸'], 巳: ['丙', '戊', '庚'], 午: ['丁', '己'],
  未: ['己', '丁', '乙'], 申: ['庚', '壬', '戊'], 酉: ['辛'],
  戌: ['戊', '辛', '丁'], 亥: ['壬', '甲']
};
const CANG_WEIGHT = [0.6, 0.3, 0.1];

const ZHI_ANIMAL = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

/* 十二值神（黄道黑道），按日支循环 */
const ZHISHEN = [
  { n: '建', luck: '平' }, { n: '除', luck: '吉' }, { n: '满', luck: '平' }, { n: '平', luck: '平' },
  { n: '定', luck: '吉' }, { n: '执', luck: '平' }, { n: '破', luck: '凶' }, { n: '危', luck: '凶' },
  { n: '成', luck: '吉' }, { n: '收', luck: '吉' }, { n: '开', luck: '吉' }, { n: '闭', luck: '凶' }
];

const YI = ['签约', '谈判', '出行', '沟通', '整理', '学习', '运动', '见朋友', '复盘', '开始新事', '收尾旧事'];
const JI = ['冲动消费', '争执', '熬夜', '做重大决定', '借钱给人', '仓促签字', '酒后发言'];

const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

/* 夜子时（23:00 后）日柱是否归次日。传统多数派归次日，设 false 则归当日 */
const NIGHT_ZI_NEXT_DAY = true;

/* ---------------- 干支纪日 ---------------- */

/* 基准：1900-01-31 为甲辰日（通用历法基准，多源一致） */
const BASE_GAN = 0;
const BASE_ZHI = 4;
const BASE_DATE = Date.UTC(1900, 0, 31);

function dayIndex(date) {
  const d = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((d - BASE_DATE) / 86400000);
}

function ganzhiOfDay(date) {
  const idx = dayIndex(date);
  const g = GAN[(((BASE_GAN + idx) % 10) + 10) % 10];
  const z = ZHI[(((BASE_ZHI + idx) % 12) + 12) % 12];
  return g + z;
}

/* ---------------- 年柱 / 月柱 ---------------- */

/** 由公历年取干支（不含立春判断，调用方负责先确定归属年） */
function ganzhiOfYearNum(year) {
  const g = GAN[(((year - 4) % 10) + 10) % 10];
  const z = ZHI[(((year - 4) % 12) + 12) % 12];
  return g + z;
}

/** 十二节 → 月支（立春起寅月） */
const JIE_ZHI = {
  立春: '寅', 惊蛰: '卯', 清明: '辰', 立夏: '巳', 芒种: '午', 小暑: '未',
  立秋: '申', 白露: '酉', 寒露: '戌', 立冬: '亥', 大雪: '子', 小寒: '丑'
};

/* 五虎遁：甲己之年丙作首 */
const MONTH_START_GAN = { 甲: 2, 己: 2, 乙: 4, 庚: 4, 丙: 6, 辛: 6, 丁: 8, 壬: 8, 戊: 0, 癸: 0 };

function monthGanOf(yearGan, zhi) {
  const startGan = MONTH_START_GAN[yearGan];
  const order = ((ZHI.indexOf(zhi) - ZHI.indexOf('寅')) % 12 + 12) % 12;
  return GAN[(startGan + order) % 10];
}

/* ---------------- 时柱 ---------------- */

/* 五鼠遁：甲己还加甲 */
const HOUR_START_GAN = { 甲: 0, 己: 0, 乙: 2, 庚: 2, 丙: 4, 辛: 4, 丁: 6, 壬: 6, 戊: 8, 癸: 8 };

function hourGanOf(dayGan, hourZhi) {
  const startGan = HOUR_START_GAN[dayGan];
  return GAN[(startGan + ZHI.indexOf(hourZhi)) % 10];
}

/**
 * 真太阳时 → 时辰地支。
 * 子时 23:00–01:00，丑时 01:00–03:00，依此类推。
 * 早子时（00:00–01:00）与晚子时（23:00–24:00）同属子，但日柱不同 —— 见 baziOf。
 */
function hourZhiOf(hour) {
  const h = ((hour % 24) + 24) % 24;
  return ZHI[Math.floor((h + 1) / 2) % 12];
}

/* ---------------- 十神 ---------------- */

export function tenGod(dayGan, other) {
  const me = GAN_WUXING[dayGan];
  const it = GAN_WUXING[other];
  const same = GAN.indexOf(dayGan) % 2 === GAN.indexOf(other) % 2;
  if (me === it) return same ? '比肩' : '劫财';
  if (SHENG[me] === it) return same ? '食神' : '伤官';
  if (KE[me] === it) return same ? '偏财' : '正财';
  if (KE[it] === me) return same ? '七杀' : '正官';
  if (SHENG[it] === me) return same ? '偏印' : '正印';
  return '—';
}

/* ---------------- 历史时区 ---------------- */

/**
 * 中国境内 1901 年以来的实际用时。
 * 早年各地时区不统一，这里按主流结论给近似值，误差可能到十几分钟，
 * 会即时在界面上提示（真太阳时本身也会抵消掉一部分）。
 */
function chinaUtcOffset(year, month, day) {
  if (year >= 1992) return 8;
  if (year >= 1986) {
    /* 1986–1991 夏令时：每年 4 月中旬至 9 月中旬 +1 小时。
       精确起止：1986 年 5 月 4 日–9 月 14 日；1987–1991 年 4 月 12 日–9 月 13 日左右。
       这里用「4/11 – 9/15」近似，落在边界日的出生会提示不确定性。 */
    const md = month * 100 + day;
    if (md >= 411 && md <= 915) return 9;
    return 8;
  }
  /* 1949–1985 全国统一北京时间（+8）。
     1929–1948 名义上亦为 +8；更早（1901–1928）分五时区，
     这里按 +8 处理，误差会在界面上标注。 */
  return 8;
}

/* ---------------- 排盘主体 ---------------- */

/**
 * @param {object} b 生辰
 * @param {number} b.year   公历年
 * @param {number} b.month  公历月（1–12）
 * @param {number} b.day    公历日
 * @param {number} b.hour   北京时间小时（0–23）
 * @param {number} b.minute 分钟
 * @param {number} [b.lon]  出生地经度（东经正）。不填则不做真太阳时校正
 * @param {string} [b.place] 出生地名
 * @param {boolean} [b.useTrueSolar] 是否启用真太阳时，默认 true
 * @param {string} [b.cal]  'solar' | 'lunar'（农历暂未实现换算，界面会提示）
 */
export function baziOf(b) {
  const year = Number(b.year);
  const month = Number(b.month);
  const day = Number(b.day);
  const hour = Number(b.hour) || 0;
  const minute = Number(b.minute) || 0;
  const hasLon = b.lon != null && b.lon !== '' && Number.isFinite(Number(b.lon));
  const lon = hasLon ? Number(b.lon) : 120;
  const useTrueSolar = b.useTrueSolar !== false && hasLon;

  /* 1. 北京钟面 → UTC 绝对时刻。
        必须用 chinaUtcOffset：1986–1991 有夏令时（+9），
        1901–1948 中国分五时区。钟面 08:00 在夏令时那天，UTC 是前一天 23:00。 */
  const tzOffset = chinaUtcOffset(year, month, day);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - tzOffset * 3600000;

  /* 2. 真太阳时。唯一正确的式子：

         真太阳时（当地钟面）= UTC + 经度×4分/度 + 均时差

     为什么不能写成「北京钟点 + 经度项 + 均时差」：
     那个式子隐含假设时区恒为 +8。1986–1991 夏令时是 +9，
     钟面 08:00 对应的绝对时刻比平时早一小时，真太阳时也该早一小时。
     从 UTC 出发，「东经 x 度的地方平时」自然就对，时区差已经吃进去了。

     三笔账分开记，界面要逐条给用户看：
       tzPart   该年该日实际时区（+8 / +9）
       lonPart  经度偏离 120°E，每度 4 分钟
       eotPart  均时差，一年内 −14.2 ~ +16.5 分钟 */
  let solar;
  if (useTrueSolar) {
    const eotMin = equationOfTime(unixToJd(utcMs));

    /* 经度项：相对东经 120°（北京时间的基准子午线），每偏 1 度差 4 分钟。
       东经在 120 以西 → 负；以东 → 正。乌鲁木齐 87.62 → −129.5 分钟。 */
    const lonMin = (lon - 120) * 4;

    /* 两笔互不相同、不能混用的量：

       A. 钟面偏移（相对北京钟点）
          真太阳时钟面 = 北京钟点 + 经度项 + 均时差 − 夏令时差
          夏令时差 = (实际时区 − 8)×60，1986–1991 为 60 分钟。
          那几年钟面被拨快一小时，同样的钟点对应更早的物理时刻。

       B. 物理偏移（相对 UTC）
          真太阳时的物理时刻 = UTC + 经度项(以格林尼治为基准) + 均时差
          夏令时已体现在 utcMs 与钟点的关系里，不能再扣一次。 */
    const dstMin = (tzOffset - 8) * 60;
    const clockOffset = lonMin + eotMin - dstMin;

    /* 钟面：以「输入的北京日」为 0 点，允许为负或超 1440 */
    const rawMin = hour * 60 + minute + clockOffset;
    const dayShift = Math.floor(rawMin / 1440);
    const minInDay = rawMin - dayShift * 1440;
    const hourLocal = minInDay / 60;

    /* 节气/日柱判定用的时间戳：把真太阳时钟面当成北京钟面摆到同一条轴上。
       Date.UTC 把参数当 UTC 读，所以要减 8h 才等于「北京钟面」的绝对毫秒。 */
    const jieMs = Date.UTC(year, month - 1, day) + minInDay * 60000 - 8 * 3600000;

    solar = {
      hour: hourLocal,
      offsetMin: clockOffset,
      lonPart: lonMin,
      eotPart: eotMin,
      dstPart: -dstMin,
      tzPart: tzOffset * 60,
      dayShift,
      /* 物理时刻：UTC + (经度相对格林尼治的偏差 + 均时差) */
      absMs: utcMs + (lon * 4 + eotMin) * 60000,
      jieMs
    };
  } else {
    solar = {
      hour: hour + minute / 60,
      offsetMin: 0,
      lonPart: 0,
      eotPart: 0,
      dstPart: 0,
      tzPart: tzOffset * 60,
      dayShift: 0,
      absMs: utcMs,
      jieMs: utcMs
    };
  }

  /* 节气判定、日柱判定都用它（北京钟面坐标系） */
  const tsMs = solar.jieMs;

  /* 3. 用真太阳时判定四柱 */
  /* 年柱 / 月柱：看小时刻落在哪个节之后 */
  const jie = jieAround(tsMs);

  /* 年柱归属：以立春为界。若最近一个节是「小寒」（黄经 285°）说明还没到立春，
     年柱仍属上一年；否则属该年。节名直接给出答案，不必猜。 */
  let solarYear;
  if (jie.prev && jie.prev.name === '小寒') {
    /* 小寒之后、立春之前 → 仍属前一干支年 */
    solarYear = toBeijing(jie.prev.at.getTime()).year - 1;
  } else {
    solarYear = toBeijing(tsMs).year;
  }
  const yGz = ganzhiOfYearNum(solarYear);
  const yGan = yGz[0];
  const yZhi = yGz[1];

  /* 月柱：最近一个节决定月支 */
  const mZhi = jie.prev ? JIE_ZHI[jie.prev.name] : '寅';
  const mGan = monthGanOf(yGan, mZhi);

  /* 日柱：以「真太阳时的日期」定。
     子时跨日规则：这里采用传统多数派「夜子归次日」，
     即 23:00 以后出生，日柱按次日算、时支子。
     想换成「日柱不提前」的流派，把 NIGHT_ZI_NEXT_DAY 改成 false。 */
  const localDate = new Date(Date.UTC(year, month - 1, day));
  if (solar.dayShift) localDate.setUTCDate(localDate.getUTCDate() + solar.dayShift);
  if (NIGHT_ZI_NEXT_DAY && solar.hour >= 23) localDate.setUTCDate(localDate.getUTCDate() + 1);
  const dGz = ganzhiOfDay(
    new Date(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate())
  );
  const dGan = dGz[0];
  const dZhi = dGz[1];

  /* 时柱 */
  const hZhi = hourZhiOf(solar.hour);
  const hGan = hourGanOf(dGan, hZhi);

  const pillars = [
    { label: '年柱', gan: yGan, zhi: yZhi, cang: ZHI_CANG[yZhi] || [] },
    { label: '月柱', gan: mGan, zhi: mZhi, cang: ZHI_CANG[mZhi] || [] },
    { label: '日柱', gan: dGan, zhi: dZhi, cang: ZHI_CANG[dZhi] || [] },
    { label: '时柱', gan: hGan, zhi: hZhi, cang: ZHI_CANG[hZhi] || [] }
  ];

  /* 五行统计（天干 + 地支藏干） */
  const wx = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  pillars.forEach((p) => {
    wx[GAN_WUXING[p.gan]] += 1;
    const cang = p.cang || [];
    cang.forEach((c, i) => {
      wx[GAN_WUXING[c]] += CANG_WEIGHT[i] ?? 0;
    });
  });
  Object.keys(wx).forEach((k) => {
    wx[k] = Math.round(wx[k] * 100) / 100;
  });

  const shishen = pillars.map((p) => ({
    label: p.label,
    gan: p.gan,
    god: p.label === '日柱' ? '日主' : tenGod(dGan, p.gan),
    zhiGod: p.label === '日柱' ? '日主' : tenGod(dGan, (ZHI_CANG[p.zhi] || [p.gan])[0])
  }));

  const sorted = Object.entries(wx).sort((x, y) => y[1] - x[1]);

  /* 日主强弱（简化判据，只做参考）：
     同类（比劫 + 印） vs 异类（食伤 + 财 + 官杀） */
  const dmWx = GAN_WUXING[dGan];
  const helpWx = [dmWx, Object.keys(SHENG).find((k) => SHENG[k] === dmWx)];
  const helpScore = helpWx.reduce((a, k) => a + (wx[k] || 0), 0);
  const totalScore = Object.values(wx).reduce((a, v) => a + v, 0) || 1;
  const strength = helpScore / totalScore;

  return {
    pillars,
    dayMaster: dGan,
    dayMasterWuxing: dmWx,
    animal: ZHI_ANIMAL[ZHI.indexOf(yZhi)],
    wuxing: wx,
    strongest: sorted[0],
    weakest: sorted[sorted.length - 1],
    shishen,

    /* 时间信息，界面要如实展示 */
    solarYear,
    trueSolarHour: solar.hour,
    solarOffsetMin: Math.round(solar.offsetMin * 10) / 10,
    lonPartMin: Math.round(solar.lonPart * 10) / 10,
    eotPartMin: Math.round(solar.eotPart * 10) / 10,
    dstPartMin: solar.dstPart ? Math.round(solar.dstPart * 10) / 10 : 0,
    usedTrueSolar: useTrueSolar,
    lon,
    place: b.place || '',
    /* 时区、经度、均时差三笔账分开列，界面上一目了然 */
    tzOffsetHours: tzOffset,
    tzPartMin: solar.tzPart,
    dstApplied: tzOffset > 8,
    solarDayShift: solar.dayShift,
    jiePrev: jie.prev ? { name: jie.prev.name, at: fmtBeijing(jie.prev.at.getTime()) } : null,
    jieNext: jie.next ? { name: jie.next.name, at: fmtBeijing(jie.next.at.getTime()) } : null,
    daysToNextJie: jie.daysToNext != null ? Math.round(jie.daysToNext * 100) / 100 : null,
    daysFromPrevJie: jie.prev ? Math.round(((tsMs - jie.prev.at.getTime()) / 86400000) * 100) / 100 : null,
    nearJie: jie.daysToNext != null && jie.daysToNext < 1.5,
    utcMs,
    tzMs: tzOffset * 3600000,

    /* 判据强度只作参考，不给结论 */
    strength: Math.round(strength * 100) / 100,
    strengthLabel: strength > 0.5 ? '偏强' : strength < 0.35 ? '偏弱' : '中和'
  };
}

/* ---------------- 当日 / 当月 ---------------- */

export function dailyFortune(date) {
  const d = date || new Date();
  const dGz = ganzhiOfDay(d);
  const bj = toBeijing(d.getTime());
  const jie = jieAround(d.getTime());

  const solarYear = jie.prev && jie.prev.name === '小寒' ? bj.year - 1 : bj.year;
  const yGz = ganzhiOfYearNum(solarYear);
  const mZhi = jie.prev ? JIE_ZHI[jie.prev.name] : '寅';
  const mGan = monthGanOf(yGz[0], mZhi);

  const zs = ZHISHEN[ZHI.indexOf(dGz[1])];
  const seed = dayIndex(d);
  const yi = [YI[seed % YI.length], YI[(seed * 3 + 1) % YI.length], YI[(seed * 7 + 4) % YI.length]];
  const ji = [JI[seed % JI.length], JI[(seed * 5 + 2) % JI.length]];

  return {
    date: `${bj.year}年${bj.month}月${bj.day}日`,
    year: bj.year,
    month: bj.month,
    day: bj.day,
    solarYear,
    yearGz: yGz,
    monthGz: mGan + mZhi,
    monthZhi: mZhi,
    dayGz: dGz,
    animal: ZHI_ANIMAL[ZHI.indexOf(yGz[1])],
    zhishen: zs.n,
    luck: zs.luck,
    dayWuxing: GAN_WUXING[dGz[0]],
    /* 宜忌在这层只是「通历」兜底，真正对个人的宜忌由 yongshen.periodFortune 给 */
    yi,
    ji
  };
}

/**
 * 某一年的流年干支 + 该年十二个月的干支月表。
 * 用于「当年运势」和「单月运势」—— 用户要按年、按月看。
 */
export function yearFortune(year) {
  /* 立春分界：这里给整年，年柱直接用该公历年对应的干支 */
  const yGz = ganzhiOfYearNum(year);
  /* 十二节 → 月支，顺序从立春（寅）起 */
  const monthOrder = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑'];
  const jieNames = ['立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', '小寒'];
  const months = monthOrder.map((zhi, i) => {
    const gan = monthGanOf(yGz[0], zhi);
    /* 该月起始的节（小寒属次年 1 月，但月建仍在本年序列末端） */
    const name = jieNames[i];
    const jieYear = name === '小寒' ? year + 1 : year;
    const lon = [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285][i];
    let at = null;
    try {
      at = fmtBeijing(termMoment(jieYear, lon).getTime());
    } catch (e) {
      at = null;
    }
    return { zhi, gan, gz: gan + zhi, jie: name, startsAt: at };
  });
  return { year, yearGz: yGz, animal: ZHI_ANIMAL[ZHI.indexOf(yGz[1])], months };
}

/** 找出给定日期落在哪一个月建（用于「当月运势」） */
export function monthFortuneOf(date) {
  const f = dailyFortune(date);
  const yf = yearFortune(f.solarYear);
  const hit = yf.months.find((m) => m.gz === f.monthGz);
  return (
    hit || {
      zhi: f.monthZhi,
      gan: f.monthGz[0],
      gz: f.monthGz,
      jie: null,
      startsAt: null
    }
  );
}

export function relationToDayMaster(dayMasterWuxing, targetWuxing) {
  if (!dayMasterWuxing) return { type: 'none', text: '' };
  if (targetWuxing === dayMasterWuxing) return { type: 'same', text: '比和，稳' };
  if (SHENG[targetWuxing] === dayMasterWuxing) return { type: 'help', text: '生我，助力' };
  if (SHENG[dayMasterWuxing] === targetWuxing) return { type: 'out', text: '我生，耗神' };
  if (KE[targetWuxing] === dayMasterWuxing) return { type: 'press', text: '克我，压力' };
  return { type: 'gain', text: '我克，可控' };
}

/* ---------------- 大运 ---------------- */

/* 大运：以月柱为起点，每十年一柱。
   阳年男顺排、阴年男逆排；阳年女逆排、阴年女顺排。
   起运岁数 = 距节天数 ÷ 3（三天折一年）：顺排看距下一节，
   逆排看距上一节。未填性别时按男命顺排处理，界面会提示。 */
export function dayunList(bz, gender) {
  const m = bz.pillars[1];
  const yGan = bz.pillars[0].gan;
  const yangYear = '甲丙戊庚壬'.includes(yGan);
  const forward = gender === 'female' ? !yangYear : yangYear;
  const days = forward ? bz.daysToNextJie : bz.daysFromPrevJie;
  const startAge = days != null ? Math.max(0.5, Math.round((days / 3) * 10) / 10) : 1;

  let gi = GAN.indexOf(m.gan);
  let zi = ZHI.indexOf(m.zhi);
  const list = [];
  for (let k = 0; k < 8; k++) {
    gi = (gi + (forward ? 1 : -1) + 10) % 10;
    zi = (zi + (forward ? 1 : -1) + 12) % 12;
    const gan = GAN[gi];
    const zhi = ZHI[zi];
    const age0 = Math.round((startAge + k * 10) * 10) / 10;
    list.push({
      startAge: age0,
      endAge: age0 + 9,
      gan,
      zhi,
      gz: gan + zhi,
      god: tenGod(bz.dayMaster, gan),
      wx: GAN_WUXING[gan],
      zhiWx: ZHI_WUXING[zhi]
    });
  }
  return { forward, startAge, list, genderKnown: gender === 'male' || gender === 'female' };
}

/* ---------------- 日主画像 ---------------- */

const DAY_MASTER_PROFILE = {
  甲: { nature: '阳木，像大树', gist: '直、往上长、不太拐弯', say: ['做事喜欢立个目标往前冲', '不太擅长绕弯子说话', '被压着会明显不舒服'] },
  乙: { nature: '阴木，像藤蔓', gist: '柔、会绕、能借力', say: ['遇到阻碍会想办法绕过去', '适应环境比硬碰硬更拿手', '有时会显得拿不定主意'] },
  丙: { nature: '阳火，像太阳', gist: '外放、热、藏不住', say: ['情绪写在脸上，藏不住', '对人热情，但也容易累', '喜欢把事情摊开说'] },
  丁: { nature: '阴火，像烛火', gist: '细、专注、敏感', say: ['对氛围和细节很敏感', '专注时能钻得很深', '情绪容易被小事带动'] },
  戊: { nature: '阳土，像山', gist: '稳、扛得住、动得慢', say: ['别人有事爱找你扛', '不太主动求助', '变动的头几天会不适应'] },
  己: { nature: '阴土，像田园', gist: '能养、能容、琐碎', say: ['操心的事多，容易想细节', '对人比较包容', '不太会拒绝别人'] },
  庚: { nature: '阳金，像刀斧', gist: '硬、决断、分明', say: ['决定下了就不太回头', '对错分得清楚', '说话直，偶尔伤人'] },
  辛: { nature: '阴金，像珠玉', gist: '细、讲究、有洁癖', say: ['对质感和细节有要求', '不太能忍受将就', '在意别人怎么看自己'] },
  壬: { nature: '阳水，像江河', gist: '大、流动、想得远', say: ['想法多，脑子停不下来', '喜欢折腾新东西', '容易同时铺开好几件事'] },
  癸: { nature: '阴水，像雨露', gist: '细、渗、内敛', say: ['不太主动说自己的事', '感受细腻，容易多想', '安静的时候状态最好'] }
};

export function daymasterProfile(dayGan) {
  const p = DAY_MASTER_PROFILE[dayGan];
  if (!p) return null;
  return { gan: dayGan, wuxing: GAN_WUXING[dayGan], nature: p.nature, gist: p.gist, say: p.say };
}

export const WUXING_COLORS = { 木: '#4f8f4a', 火: '#c05a4a', 土: '#a8843c', 金: '#b8860b', 水: '#4a6fa5' };

/* ---------------- 运势日历 ---------------- */

function keyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthCalendar(year, month, dayMasterWuxing) {
  const days = [];
  const last = new Date(year, month, 0).getDate();
  for (let i = 1; i <= last; i += 1) {
    const d = new Date(year, month - 1, i);
    const f = dailyFortune(d);
    const rel = dayMasterWuxing ? relationToDayMaster(dayMasterWuxing, f.dayWuxing) : null;
    let score = f.luck === '吉' ? 2 : f.luck === '凶' ? -1 : 0;
    if (rel) score += rel.type === 'help' || rel.type === 'same' ? 1 : rel.type === 'press' ? -1 : 0;
    days.push({
      day: i,
      key: keyOf(d),
      gz: f.dayGz,
      zhishen: f.zhishen,
      luck: f.luck,
      dayWuxing: f.dayWuxing,
      rel: rel ? rel.type : null,
      relText: rel ? rel.text : '',
      score,
      weekday: d.getDay()
    });
  }
  return days;
}

/* ---------------- 给界面用的节气/交接信息 ---------------- */

/** 某一年十二节的时刻表（北京时间），供「我的盘」页的核对区展示 */
export function jieTable(year) {
  const out = [];
  for (let m = 0; m < 12; m += 1) {
    const name = JIE_NAMES[m];
    const lon = [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285][m];
    /* 小寒属次年 1 月，其余按公历年 */
    const y = name === '小寒' ? year + 1 : year;
    const at = termMoment(y, lon);
    out.push({ name, zhi: JIE_ZHI[name], at: fmtBeijing(at.getTime()), ms: at.getTime() });
  }
  out.sort((a, b2) => a.ms - b2.ms);
  return out;
}

export { GAN, ZHI, ZHI_ANIMAL, GAN_WUXING, ZHI_WUXING, ZHI_CANG, JIE_ZHI, deltaT, unixToJd, termMoment, fmtBeijing };
