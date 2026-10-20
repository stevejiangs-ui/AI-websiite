/* 生活维度：把用户关心的事落成一套固定分类（围绕 财富 / 家庭 / 开心 / 健康 / 形象）。
   日记用 facets 字段（string[]）记录这篇内容涉及哪些维度，一篇可以同时属于多个。 */

export const FACETS = [
  { k: 'work', label: '工作', icon: '◇', color: '#4a6fa5', desc: '当天的工作进展、会议、卡点' },
  { k: 'chores', label: '琐事', icon: '⋯', color: '#8a8a9c', desc: '跑腿、缴费、修东西这类小事' },
  { k: 'spend', label: '花销', icon: '¥', color: '#b4552f', desc: '今天花了什么钱、值不值' },
  { k: 'bank', label: '银行', icon: '▤', color: '#7a6a4f', desc: '账户、贷款、转账、利率、投资' },
  { k: 'legal', label: '法务', icon: '§', color: '#6b5b8a', desc: '合同、税务、签证、纠纷' },
  { k: 'note', label: '随手记', icon: '✎', color: '#9a958c', desc: '突然想到的、没头没尾的' },
  { k: 'appearance', label: '形象', icon: '✧', color: '#c4738f', desc: '穿着、打理、体重外形' },
  { k: 'family', label: '家庭', icon: '⌂', color: '#d0703f', desc: '家人、孩子、父母、家里的事' },
  { k: 'joy', label: '开心事', icon: '☀', color: '#d9a03a', desc: '让你开心、感恩、有成就感的小事' },
  { k: 'relation', label: '关系', icon: '♡', color: '#cf7a5e', desc: '朋友、同事、合作伙伴的相处' },
  { k: 'health', label: '健康', icon: '✚', color: '#3f8c5e', desc: '睡眠、运动、饮食、身体信号' },
  { k: 'fortune', label: '运势', icon: '☯', color: '#5aa9a3', desc: '当天的玄学/命理想法' }
];

export const FACET_KEYS = FACETS.map((f) => f.k);

export function facetOf(k) {
  return FACETS.find((f) => f.k === k);
}

export function facetLabels(keys) {
  return (Array.isArray(keys) ? keys : []).map((k) => facetOf(k)?.label || k);
}

/* 统一取一篇日记的维度：优先 facets，老数据退回到 tags */
export function entryFacets(entry) {
  const f = entry?.facets;
  if (Array.isArray(f) && f.length) return f.filter((k) => FACET_KEYS.includes(k));
  const tags = String(entry?.tags || '').split(/[,，\s]+/).filter(Boolean);
  return tags.filter((t) => FACET_KEYS.includes(t));
}

/* 目标分类 */
export const GOAL_CATEGORIES = [
  { k: 'career', label: '事业', color: '#4a6fa5' },
  { k: 'money', label: '财务', color: '#b4552f' },
  { k: 'health', label: '健康', color: '#3f8c5e' },
  { k: 'relation', label: '关系', color: '#cf7a5e' },
  { k: 'growth', label: '成长', color: '#6b5b8a' },
  { k: 'life', label: '生活', color: '#5aa9a3' }
];

export function goalCatOf(k) {
  return GOAL_CATEGORIES.find((c) => c.k === k) || { k, label: k || '其他', color: '#9a958c' };
}
