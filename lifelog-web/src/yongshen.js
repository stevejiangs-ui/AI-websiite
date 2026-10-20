/* 喜用神推算（扶抑法 / 旺衰取用）

   子平八字取用神的方法有几种流派，这里用最主流、也最能自圆其说的
   「扶抑法」：先判断日主旺衰，再决定补什么、泄什么。

   核心逻辑：
     1. 把四柱的干支换算成五行力量（天干 1 分，地支藏干按 0.6/0.3/0.1 分摊）
     2. 月令加权（月支管一季之气，力量最大，×1.5）
     3. 得令/得地/得势三项辅助判断
     4. 日主偏强 → 喜「克泄耗」（官杀、食伤、财）
        日主偏弱 → 喜「生扶」（印、比劫）
     5. 从旺衰程度再细分：极强考虑「从强」，极弱考虑「从弱」

   重要说明：命理不是精密科学，同一八字不同流派结论可能不同。
   这里给出的是有据可循的推算，并在界面上写明推断依据，
   让用户自己能看懂「为什么是这几个」，而不是甩一个结论。
*/

import { GAN_WUXING, ZHI_CANG } from './bazi.js';

const WUXING = ['木', '火', '土', '金', '水'];
const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
/* 生我者（印） */
const SHENG_ME = Object.fromEntries(Object.entries(SHENG).map(([a, b]) => [b, a]));

const CANG_WEIGHT = [0.6, 0.3, 0.1];

/* 各五行的性格/取象，用于把结论翻译成人话 */
const WUXING_TRAIT = {
  木: { nature: '生发、条达', feel: '往上长、爱计划、要空间', color: '绿、青', dir: '东', organ: '肝胆' },
  火: { nature: '炎上、明亮', feel: '热、急、要表达', color: '红、紫', dir: '南', organ: '心、小肠' },
  土: { nature: '厚载、居中', feel: '稳、慢、要落地', color: '黄、褐', dir: '中', organ: '脾胃' },
  金: { nature: '收敛、肃杀', feel: '硬、准、要规矩', color: '白、银', dir: '西', organ: '肺、大肠' },
  水: { nature: '润下、流动', feel: '柔、深、要变化', color: '黑、蓝', dir: '北', organ: '肾、膀胱' }
};

/* 十神对应的「用神角色」 */
const ROLE = {
  '比劫': { name: '比劫', what: '同类之气', do: '帮身、扛事、增加底气' },
  '印': { name: '印星', what: '生我之气', do: '补给、学习、被照顾' },
  '食伤': { name: '食伤', what: '我生之气', do: '表达、创造、往外走' },
  '财': { name: '财星', what: '我克之气', do: '实务、得利、管资源' },
  '官杀': { name: '官杀', what: '克我之气', do: '规矩、责任、压力' }
};

/**
 * 统计四柱五行力量。
 * @param {object} chart baziOf() 的返回，含 pillars: [{gan, zhi, cang}]
 */
export function wuxingStrength(chart) {
  const score = Object.fromEntries(WUXING.map((w) => [w, 0]));
  const detail = [];

  chart.pillars.forEach((p, idx) => {
    const isMonthZhi = idx === 1; // 月支
    // 天干
    const gw = GAN_WUXING[p.gan];
    if (gw) {
      const v = isMonthZhi ? 1.5 : 1;
      score[gw] += v;
      detail.push({ src: `${p.label}天干${p.gan}`, wx: gw, val: v });
    }
    // 地支藏干（月支加权）
    const cang = p.cang && p.cang.length ? p.cang : ZHI_CANG[p.zhi] || [];
    cang.forEach((g, i) => {
      const w = GAN_WUXING[g];
      if (!w) return;
      const base = CANG_WEIGHT[i] ?? 0.1;
      const v = base * (isMonthZhi ? 1.5 : 1);
      score[w] += v;
      detail.push({ src: `${p.label}地支${p.zhi}藏${g}`, wx: w, val: +v.toFixed(2) });
    });
  });

  // 归一到整数百分比
  const total = WUXING.reduce((a, w) => a + score[w], 0) || 1;
  const pct = Object.fromEntries(WUXING.map((w) => [w, +((score[w] / total) * 100).toFixed(1)]));

  return { score, pct, total, detail };
}

/**
 * 判断日主旺衰，给出喜用神。
 *
 * 判定顺序（扶抑法）：
 *   1. 得令：日主五行在月支是否当令（月令生扶日主）
 *   2. 得地：日支是否生扶日主
 *   3. 得势：同类（比劫+印）在全局占比
 *   三项综合得出「扶」的力量占比，>50% 偏强，<40% 偏弱。
 */
export function favorableGods(chart) {
  const me = chart.dayMasterWuxing;
  const { score, pct, total } = wuxingStrength(chart);

  const mother = SHENG_ME[me]; // 印
  const same = me; // 比劫
  const child = SHENG[me]; // 食伤
  const wealth = KE[me]; // 财
  const officer = Object.keys(KE).find((k) => KE[k] === me); // 官杀

  /* ---- 1. 得令：月支本气是否为生扶日主的五行 ---- */
  const monthPillar = chart.pillars[1];
  const monthMain = (monthPillar.cang && monthPillar.cang[0]) || null;
  const monthWx = monthMain ? GAN_WUXING[monthMain] : null;
  const deLing = monthWx === me || monthWx === mother;

  /* ---- 2. 得地：日支是否生扶 ---- */
  const dayZhiWx = GAN_WUXING[(chart.pillars[2].cang || [])[0]] || null;
  const deDi = dayZhiWx === me || dayZhiWx === mother;

  /* ---- 3. 扶的力量占比（比劫 + 印） ---- */
  const support = score[same] + score[mother];
  const supportPct = +((support / total) * 100).toFixed(1);

  /* ---- 综合判定 ---- */
  /* 得令 / 得地各算一票加权，避免只看数字 */
  let adj = supportPct;
  if (deLing) adj += 12;
  if (deDi) adj += 8;

  let verdict; // 强 / 弱 / 中和
  let bias;
  if (adj >= 62) {
    verdict = '偏强';
    bias = 'strong';
  } else if (adj <= 38) {
    verdict = '偏弱';
    bias = 'weak';
  } else if (adj >= 52) {
    verdict = '中和偏强';
    bias = 'mild-strong';
  } else if (adj <= 48) {
    verdict = '中和偏弱';
    bias = 'mild-weak';
  } else {
    verdict = '中和';
    bias = 'balanced';
  }

  /* 极强 / 极弱 → 从格提示 */
  const extreme =
    adj >= 85 ? 'cong-strong' : adj <= 15 ? 'cong-weak' : null;

  /* ---- 取喜用 ----
     偏强：需要泄耗克 → 用食伤（泄）、财（耗）、官杀（克）
     偏弱：需要生扶   → 用印（生）、比劫（帮）
     中和：取月令所得之气顺势，或取全局最缺的那一行补之 */
  let useful = []; // 用神（主）
  let favorable = []; // 喜神（辅）
  let avoid = []; // 忌神
  let reasoning = [];

  if (extreme === 'cong-strong') {
    useful = [same, child];
    favorable = [mother];
    avoid = [officer, wealth];
    reasoning.push('日主气势极旺（扶身之力超过八成），按「从强」论，顺其势用比劫、食伤，不逆克。');
  } else if (extreme === 'cong-weak') {
    useful = [mother, same];
    favorable = [];
    avoid = [officer, wealth, child];
    reasoning.push('日主极弱（扶身之力不足两成），按「从弱」论，不宜硬扶，反宜从官杀财势。');
  } else if (bias === 'strong' || bias === 'mild-strong') {
    useful = [child, wealth];
    favorable = [officer];
    avoid = [same, mother];
    reasoning.push(`日主${verdict}，扶身之力${supportPct}%${deLing ? '、且得月令' : ''}，不宜再补。`);
    reasoning.push('取食伤泄其秀气、财星耗其余力为用，官杀约束为喜。');
  } else if (bias === 'weak' || bias === 'mild-weak') {
    useful = [mother, same];
    favorable = [];
    avoid = [officer, wealth, child];
    reasoning.push(`日主${verdict}，扶身之力仅${supportPct}%${deLing ? '' : '、且不得月令'}，需生扶。`);
    reasoning.push('取印星生身为用、比劫帮身为辅；官杀克身、财星耗身，宜避。');
  } else {
    // 中和：看哪一行最弱补哪行（调候思路的简化版）
    const weakest = WUXING.slice().sort((a, b) => pct[a] - pct[b])[0];
    useful = [weakest];
    favorable = [SHENG_ME[weakest]];
    avoid = [KE[weakest]];
    reasoning.push('日主中和，无明显偏枯，取全局最弱的一行为用，使五行流通不滞。');
    reasoning.push(`当前最弱的是${weakest}（${pct[weakest]}%），补之则全局更匀。`);
  }

  /* ---- 用神角色说明 ---- */
  const roleOf = (wx) => {
    if (wx === same) return ROLE['比劫'];
    if (wx === mother) return ROLE['印'];
    if (wx === child) return ROLE['食伤'];
    if (wx === wealth) return ROLE['财'];
    if (wx === officer) return ROLE['官杀'];
    return { name: wx, what: '', do: '' };
  };

  const describe = (wx) => ({
    wx,
    meta: WUXING_TRAIT[wx],
    role: roleOf(wx).name,
    what: roleOf(wx).what,
    do: roleOf(wx).do
  });

  return {
    dayMaster: chart.dayMaster,
    dayMasterWuxing: me,
    pct,
    score,
    supportPct,
    deLing,
    deDi,
    verdict,
    bias,
    extreme,
    useful: useful.filter(Boolean).map(describe),
    favorable: favorable.filter(Boolean).map(describe),
    avoid: avoid.filter(Boolean).map(describe),
    /* 补用神的通用方向 */
    advice: {
      colors: useful.concat(favorable).map((w) => WUXING_TRAIT[w]?.color).filter(Boolean),
      dirs: useful.concat(favorable).map((w) => WUXING_TRAIT[w]?.dir).filter(Boolean),
      organs: avoid.map((w) => WUXING_TRAIT[w]?.organ).filter(Boolean)
    },
    reasoning
  };
}

/**
 * 把喜用神落到「具体怎么用」—— 这是用户真正要的：
 * 颜色、方位、行业、作息、注意什么。
 */
export function applyAdvice(fg) {
  const primary = fg.useful[0]?.wx;
  const secondary = fg.favorable[0]?.wx || fg.useful[1]?.wx;
  if (!primary) return [];

  const lines = [];

  lines.push({
    k: 'color',
    title: '日常用色',
    text: `主用${primary}色系（${WUXING_TRAIT[primary].color}）${secondary ? `，辅以${secondary}色（${WUXING_TRAIT[secondary].color}）` : ''}。衣服、桌面、常用物品上带一点就够，不必整个换掉。`
  });

  lines.push({
    k: 'dir',
    title: '方位',
    text: `工作学习的位置朝${WUXING_TRAIT[primary].dir}${secondary ? `或${WUXING_TRAIT[secondary].dir}` : ''}更顺；搬家、出差的目的地也优先这个方向。`
  });

  lines.push({
    k: 'habit',
    title: '作息与性情',
    text: `${primary}主${WUXING_TRAIT[primary].nature}，宜多${WUXING_TRAIT[primary].feel.split('、')[0]}的状态；不顺的时候往往是缺了${primary}，不是缺了努力。`
  });

  if (fg.avoid.length) {
    const a = fg.avoid[0];
    lines.push({
      k: 'care',
      title: '留意',
      text: `忌神为${a.wx}（主${WUXING_TRAIT[a.wx].organ}）。${a.wx}过旺的年月，${WUXING_TRAIT[a.wx].organ}相关的疲劳会更明显，体检别跳过。`
    });
  }

  return lines;
}

/* ==================================================================
   年 / 月 / 日 三级运势
   ------------------------------------------------------------------
   为什么必须结合喜用神：
     流年流月流日只是「时间给的五行」，本身没有吉凶。同一个火旺的年份，
     对缺火的人是补，对火过旺的人是烤。旧版按日序数哈希取「宜/忌」，
     跟命主毫无关系，等于抽签 —— 这里改成：

       运的五行 ∈ 用神   → 大吉，主动用
       运的五行 ∈ 喜神   → 偏吉，可用
       运的五行 ∈ 忌神   → 偏凶，宜守
       其余              → 平

     再叠加「运的十神」（流年干支对日主的关系），给出更具体的场景：
     官杀年谈责任与压力，财年谈钱，印年谈学习与靠山，比劫年谈人与竞争，
     食伤年谈表达与创造。

   冲合只做最基础的提示（六冲 / 同支），不做复杂的神煞堆砌 ——
   堆得越多越像唬人，能对上生活才有用。
   ================================================================== */

const ZHI_CHONG = { 子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅', 卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳' };

/* 十神 → 一段能落到生活里的话（流年/流月/流日都用这套） */
const SHISHEN_SCENE = {
  比肩: { k: '比肩', scene: '同辈、合伙人、兄弟朋友的事会占分量', do: '适合并肩做事、分摊压力；别为了面子硬撑' },
  劫财: { k: '劫财', scene: '人情往来、分钱、竞争的事变多', do: '账要算清，别做担保，别合伙不立字据' },
  食神: { k: '食神', scene: '表达、手艺、吃喝、子女的事顺', do: '适合输出作品、开新课、把想法写出来' },
  伤官: { k: '伤官', scene: '想改革、想掀桌子、话容易冲', do: '改流程可以，别当众驳人脸面' },
  偏财: { k: '偏财', scene: '意外之财、副业、外部资源流动', do: '可以试新渠道，但别把身家押上去' },
  正财: { k: '正财', scene: '工资、租金、稳定的进项', do: '适合谈薪、签约、把收入结构理顺' },
  七杀: { k: '七杀', scene: '硬压力、突发任务、要扛事', do: '接硬活前先算清代价，别硬顶' },
  正官: { k: '正官', scene: '职位、规矩、上级与考核', do: '适合争取名分、走正式流程、见上级' },
  偏印: { k: '偏印', scene: '偏门学问、独自琢磨、直觉变强', do: '适合研究冷门方向，别一个人钻太深' },
  正印: { k: '正印', scene: '贵人、学历、证书、被照顾', do: '适合考试、拜师、找长辈帮忙' }
};

/* 五行 → 落到生活里的场景词（运势宜忌用） */
const WUXING_SCENE = {
  木: { yi: ['谈长期计划', '开始学新东西', '见长辈 / 上级', '户外走走'], ji: ['急着一口气做完', '跟人较劲'] },
  火: { yi: ['露面 / 演讲', '推进卡住的事', '见客户', '把话说清楚'], ji: ['熬夜', '情绪化发言', '冲动决定'] },
  土: { yi: ['整理归档', '置办固定资产', '做预算', '收尾旧事'], ji: ['贸然搬家', '答应太多事'] },
  金: { yi: ['签约 / 谈判', '做决断', '清理旧物', '核对账目'], ji: ['仓促签字', '说话太硬伤人'] },
  水: { yi: ['出门 / 出差', '沟通协调', '想新方案', '找资源'], ji: ['开车走远路', '轻信口头承诺'] }
};

/** 干支 → 五行（流年按月按日都统一用这个） */
function gzWuxing(gz) {
  return {
    gan: GAN_WUXING[gz[0]] || null,
    zhi: GAN_WUXING[(ZHI_CANG[gz[1]] || [])[0]] || null
  };
}

/** 流年/流月/流日的十神：以日主为基准看那个天干 */
function shishenOf(dayGan, other) {
  if (!dayGan || !other) return null;
  const me = GAN_WUXING[dayGan];
  const it = GAN_WUXING[other];
  if (!me || !it) return null;
  const samePolarity = '甲丙戊庚壬'.includes(dayGan) === '甲丙戊庚壬'.includes(other);
  if (me === it) return samePolarity ? '比肩' : '劫财';
  if (SHENG[me] === it) return samePolarity ? '食神' : '伤官';
  if (KE[me] === it) return samePolarity ? '偏财' : '正财';
  if (KE[it] === me) return samePolarity ? '七杀' : '正官';
  if (SHENG[it] === me) return samePolarity ? '偏印' : '正印';
  return null;
}

/**
 * 单个层级（年/月/日）的吉凶判定。
 * @param {object} fg    favorableGods() 的结果
 * @param {string} gz    该层的干支，如 '丙午'
 * @param {string} dayGan 日主天干
 */
function levelOf(fg, gz, dayGan) {
  const { gan, zhi } = gzWuxing(gz);
  const useSet = new Set(fg.useful.map((u) => u.wx));
  const favSet = new Set(fg.favorable.map((u) => u.wx));
  const avoidSet = new Set(fg.avoid.map((u) => u.wx));

  /* 天干看「明面上的气」，权重高；地支看「底下的势」，权重低一档。
     同一个干支里天干为用、地支为忌，就是「面顺底不顺」，要如实说。 */
  let score = 0;
  if (gan) score += useSet.has(gan) ? 2 : favSet.has(gan) ? 1.2 : avoidSet.has(gan) ? -2 : 0;
  if (zhi) score += useSet.has(zhi) ? 1.2 : favSet.has(zhi) ? 0.6 : avoidSet.has(zhi) ? -1.2 : 0;

  const grade = score >= 2.4 ? '大吉' : score >= 1 ? '偏吉' : score <= -2.4 ? '偏凶' : score <= -1 ? '小心' : '平';
  const gradeKey = score >= 2.4 ? 'good' : score >= 1 ? 'fair' : score <= -2.4 ? 'bad' : score <= -1 ? 'warn' : 'flat';

  const ss = shishenOf(dayGan, gz[0]);

  /* 宜：优先取「落在用神那一行」的场景；忌：取忌神那一行 */
  const yiPool = [];
  const jiPool = [];
  [gan, zhi].forEach((w) => {
    if (!w) return;
    if (useSet.has(w) || favSet.has(w)) yiPool.push(...(WUXING_SCENE[w]?.yi || []));
    if (avoidSet.has(w)) jiPool.push(...(WUXING_SCENE[w]?.ji || []));
  });
  /* 忌神那一行本身就是「别太用力」的提醒，不重复塞 */
  [gan, zhi].forEach((w) => {
    if (w && avoidSet.has(w)) jiPool.push(...(WUXING_SCENE[w]?.ji || []));
  });

  return {
    gz,
    ganWx: gan,
    zhiWx: zhi,
    score: +score.toFixed(1),
    grade,
    gradeKey,
    shishen: ss,
    scene: ss ? SHISHEN_SCENE[ss] : null,
    /* 去重、限长，界面上不堆一堆字 */
    yi: [...new Set(yiPool)].slice(0, 4),
    ji: [...new Set(jiPool)].slice(0, 3),
    /* 面顺底不顺 / 面逆底顺 这类张力，单独标出来 */
    tension: gan && zhi && (useSet.has(gan) !== useSet.has(zhi)) && !(favSet.has(gan) && favSet.has(zhi))
  };
}

/**
 * 年 / 月 / 日三级运势 —— 用户要的「当年、单月、当日的运势，
 * 注意什么，适宜做什么」。
 *
 * @param {object} fg      favorableGods() 的结果
 * @param {string} dayGan  日主天干，用来算十神
 * @param {object} t       { yearGz, monthGz, dayGz }
 * @param {object} [chart] 可选，用于日支与命局地支的冲合提示
 */
export function periodFortune(fg, dayGan, t, chart) {
  if (!fg || !t) return null;

  const year = levelOf(fg, t.yearGz, dayGan);
  const month = levelOf(fg, t.monthGz, dayGan);
  const day = levelOf(fg, t.dayGz, dayGan);

  /* 冲提示：流年/流月/流日地支冲命局日支（日支＝自己坐的位置，
     被冲最容易「明显感觉到」，所以只提示这一个，不铺满） */
  const dayZhi = chart?.pillars?.[2]?.zhi || null;
  const clash = [];
  if (dayZhi) {
    [
      ['年', t.yearGz?.[1]],
      ['月', t.monthGz?.[1]],
      ['日', t.dayGz?.[1]]
    ].forEach(([label, z]) => {
      if (z && ZHI_CHONG[z] === dayZhi) clash.push(`${label}支${z}冲你日支${dayZhi}`);
    });
  }

  /* 总评：年看趋势、月看节奏、日看当天。日权重最高，因为用户天天看的是日。 */
  const composite = +(year.score * 0.25 + month.score * 0.3 + day.score * 0.45).toFixed(1);

  const summary =
    composite >= 2.2 ? '整体顺，可以主动往前推一步'
    : composite >= 0.9 ? '偏顺，按计划推进即可'
    : composite <= -2.2 ? '整体偏紧，宜守成、少开新局'
    : composite <= -0.9 ? '有点滞，先把手上已有的收干净'
    : '平顺，不必刻意，按日常节奏走';

  /* 关键提醒：挑最需要「注意」的一条 */
  const cautions = [];
  if (day.gradeKey === 'bad' || month.gradeKey === 'bad') {
    cautions.push('今天/本月忌神当头，重大决定（签字、投钱、开口要人帮忙）往后放一放。');
  }
  if (year.gradeKey === 'bad') cautions.push('今年忌神偏旺，宜积累不宜冒进，扩张的念头先记下来。');
  if (clash.length) cautions.push(`${clash.join('；')}。日支被冲，容易在身体、住所、亲密关系上出状况，别硬撑。`);
  if (day.tension) cautions.push('今天面顺底不顺：开头顺利，收尾容易生枝节，留出余量。');
  if (fg.avoid.length) {
    const a = fg.avoid[0];
    cautions.push(`忌神是${a.wx}，${WUXING_TRAIT[a.wx].organ}是长期要留意的部位，${a.wx}旺的时段别硬扛。`);
  }

  return {
    year,
    month,
    day,
    composite,
    summary,
    clash,
    cautions: cautions.slice(0, 4),
    /* 三级合起来的宜/忌，去重后给「今天可以做什么」一个总答案 */
    yi: [...new Set([...day.yi, ...month.yi])].slice(0, 5),
    ji: [...new Set([...day.ji, ...month.ji])].slice(0, 4)
  };
}
