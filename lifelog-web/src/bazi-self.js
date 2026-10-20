/* 八字自评：把命理结论拆成可以自己验证的说法。
   设计原则——不告诉用户「你是什么样的人」，而是给出可对照的倾向描述，
   由用户自己打「像 / 说不准 / 不像」，再据此调整权重。
   命理的部分只做定位，判断权始终在用户手里。 */

import { cloud } from './cloud.js';
import { baziOf, relationToDayMaster, daymasterProfile, WUXING_COLORS } from './bazi.js';
import { FACETS, facetOf } from './facets.js';

const SELF_KEY = 'lifelog-bazi-self.v1';

/* ---------------- 自评题目 ----------------
   每个维度给 4 条可观察的说法。故意写得具体、可对照，
   避免「你有时外向有时内向」这类谁都能套上的话。 */

export const SELF_DIMENSIONS = [
  {
    k: 'drive',
    label: '做事的劲头',
    color: '#c05a4a',
    items: [
      '开始一件事比坚持一件事容易，常常开了头就放着',
      '心里认定了的事，不用别人催也会做完',
      '事情做到一半被打断，会明显烦',
      '比起做计划，更愿意先动手再调整'
    ]
  },
  {
    k: 'social',
    label: '和人相处',
    color: '#cf7a5e',
    items: [
      '人多的场合待久了会累，需要一个人缓一缓',
      '遇到陌生人能很快聊起来',
      '更愿意和少数几个人深交，不爱广撒网',
      '别人来找你倾诉的时候多过你去找别人'
    ]
  },
  {
    k: 'mind',
    label: '想事情的方式',
    color: '#4a6fa5',
    items: [
      '容易同时想到很多可能，反而难下决定',
      '习惯先把最坏的情况想清楚',
      '想到什么说什么，不太修饰',
      '别人情绪的变化，你能比较快察觉'
    ]
  },
  {
    k: 'money',
    label: '对待钱',
    color: '#b4552f',
    items: [
      '花钱前会算一下，大额支出会犹豫几天',
      '愿意为喜欢的东西花大钱，不太看性价比',
      '更在意稳定收入，不太敢冒险',
      '有过冲动消费之后后悔的经历'
    ]
  },
  {
    k: 'stress',
    label: '压力下的反应',
    color: '#6b5b8a',
    items: [
      '压力大的时候会想一个人待着，不想说话',
      '越急越容易出错，需要放慢才做得好',
      '被催的时候反而更不想动',
      '压力能推着你把事情做完'
    ]
  },
  {
    k: 'health',
    label: '身体信号',
    color: '#3f8c5e',
    items: [
      '睡眠容易受影响，想事情多的时候更难睡',
      '天气或季节变化对身体影响明显',
      '肠胃对情绪比较敏感',
      '精力起伏大，有几天特别好有几天特别差'
    ]
  }
];

/* ---------------- 五行倾向：命理 -> 可对照描述 ----------------
   这不是「算命结论」，而是把一个抽象属性翻译成一句能验证的话。
   用户可以对每一条打「像 / 拿不准 / 不像」。 */

export const ELEMENT_TRAITS = {
  木: {
    label: '木',
    gist: '生发、向上',
    say: [
      '喜欢事情有成长感，讨厌原地打转',
      '看到不公平的事容易较真',
      '不耐烦被管得太细'
    ]
  },
  火: {
    label: '火',
    gist: '外放、快',
    say: [
      '情绪来得快，也散得快',
      '做决定偏快，不太喜欢反复权衡',
      '喜欢被看见、被认可'
    ]
  },
  土: {
    label: '土',
    gist: '承载、稳',
    say: [
      '习惯把事情扛下来，不太主动求助',
      '对环境和人的变化适应得慢一些',
      '更看重踏实，不太喜欢虚的'
    ]
  },
  金: {
    label: '金',
    gist: '收敛、分明',
    say: [
      '对错分得清，界限感比较强',
      '说话直接，有时会显得不留情面',
      '喜欢把东西归置整齐'
    ]
  },
  水: {
    label: '水',
    gist: '流动、藏',
    say: [
      '想法多，但不太愿意全说出来',
      '适应力强，换个环境也能过得去',
      '容易想太多，夜里尤其明显'
    ]
  }
};

/* ---------------- 本地存档：自评结果 ----------------
   自评是主观数据，跟账号走更合理，但为了不打断使用，
   先本地存，登录后同步到 settings 表由上层负责。这里只管读写本地。 */

export function loadSelf() {
  try {
    const raw = JSON.parse(localStorage.getItem(SELF_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { answers: {}, traits: {}, updatedAt: '' };
    return {
      answers: raw.answers || {},
      traits: raw.traits || {},
      updatedAt: raw.updatedAt || ''
    };
  } catch (e) {
    return { answers: {}, traits: {}, updatedAt: '' };
  }
}

export function saveSelf(data) {
  try {
    localStorage.setItem(SELF_KEY, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------- 评分与推断 ----------------
   答案取值：1 = 像，0 = 拿不准，-1 = 不像。
   维度得分 = 命中条数占比，用于画自评画像，不用于「诊断」。 */

export function scoreDimensions(answers) {
  return SELF_DIMENSIONS.map((d) => {
    let yes = 0;
    let no = 0;
    let unsure = 0;
    d.items.forEach((_, i) => {
      const k = `${d.k}:${i}`;
      const v = answers[k];
      if (v === 1) yes += 1;
      else if (v === -1) no += 1;
      else if (v === 0) unsure += 1;
    });
    const total = d.items.length;
    return {
      k: d.k,
      label: d.label,
      color: d.color,
      yes,
      no,
      unsure,
      total,
      filled: yes + no + unsure,
      /* 认同度：像 / (像+不像)，拿不准不计入，避免稀释 */
      rate: yes + no > 0 ? yes / (yes + no) : null
    };
  });
}

/* 自评与命理的一致性：命理说某五行旺，看自评是否也对得上。
   只做提示，不做纠正——用户的感觉永远优先于命理。 */
export function consistency(bz, self) {
  if (!bz || !self) return null;
  const strong = bz.strongest[0];
  const weak = bz.weakest[0];
  const traits = self.traits || {};
  const strongVerdict = traits[strong]; // 1 / 0 / -1 / undefined
  if (strongVerdict === undefined) return null;
  return {
    strong,
    weak,
    strongVerdict,
    agree: strongVerdict === 1,
    text:
      strongVerdict === 1
        ? `命理说你${strong}偏旺，你也觉得${ELEMENT_TRAITS[strong].label}的倾向像自己，两边对得上。`
        : strongVerdict === -1
          ? `命理说你${strong}偏旺，但你觉得不像——以你自己的感觉为准，这里可能只是排盘近似造成的偏差。`
          : `你对${strong}的倾向拿了「说不准」，这很正常：五行只是粗略归类，不是性格标签。`
  };
}

/* ---------------- 问答记录（存云） ---------------- */

export async function listBaziQA(limit = 100) {
  const { data, error } = await cloud.database
    .from('bazi_qa')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function saveBaziQA(row) {
  const { error } = await cloud.database.from('bazi_qa').insert({
    day_key: row.day_key || '',
    day_gz: row.day_gz || null,
    question: row.question,
    answer: row.answer || '',
    note: row.note || null
  });
  if (error) throw error;
}

export async function deleteBaziQA(id) {
  const { error } = await cloud.database.from('bazi_qa').delete().eq('id', id);
  if (error) throw error;
}

export async function updateBaziNote(id, note) {
  const { error } = await cloud.database.from('bazi_qa').update({ note }).eq('id', id);
  if (error) throw error;
}
