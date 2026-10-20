import { cloud } from './cloud.js';

const SYSTEM_BASE = `你是用户的私人生活记录与财务分析师，能看到用户的日记和账单数据。
要求：
1. 用中文回答，像一个了解用户的朋友 + 专业财务顾问，简洁具体。
2. 引用具体数字和时间，不要编造数据。
3. 涉及消费建议时结合日记里的生活状态（比如情绪低落时的冲动消费、加班多导致外卖变多）。
4. 主动指出值得注意的模式。
5. 回答控制在 400 字以内，除非用户要求详细分析。`;

let modelId = null;
let fastModelId = null;

export async function ensureModel() {
  if (modelId) return modelId;
  const models = await cloud.llm.models.list().catch(() => []);
  const usable = models.filter((m) => m.disabled !== true && m.enabled !== false);
  const GOOD = ['claude'];
  const chosen =
    usable.find((m) => GOOD.includes(m.id)) ||
    usable.find((m) => m.isDefault) ||
    usable[0] ||
    null;
  if (!chosen) throw new Error('AI 只在 claude.ai 里打开时可用');
  modelId = chosen.id;
  return modelId;
}

/* 结构化提炼用的模型：要快、要听话输出 JSON。
   推理型模型（如 hy4-preview）会把大量 token 花在 reasoning 上，content 很久不来，
   用于「保存后立即提炼」这种前台等待的场景体验很差，所以单独挑一个非推理小模型。 */
const FAST_MODELS = ['claude-quick'];

export async function ensureFastModel() {
  if (fastModelId) return fastModelId;
  const models = await cloud.llm.models.list().catch(() => []);
  const usable = models.filter((m) => m.disabled !== true && m.enabled !== false);
  const chosen = usable.find((m) => FAST_MODELS.includes(m.id)) || null;
  if (!chosen) {
    // 没有快速模型就退回默认，至少能出结果
    fastModelId = await ensureModel();
  } else {
    fastModelId = chosen.id;
  }
  return fastModelId;
}

export function modelLabel() {
  return MODEL_NAMES[modelId] || modelId || '默认模型';
}

const MODEL_NAMES = {
  claude: 'Claude',
  'claude-quick': 'Claude（快速）'
};

export function modelDisplayName() {
  return MODEL_NAMES[modelId] || modelId || '默认模型';
}

/* 收集用户数据上下文 */
export async function buildContextData({ entries, month, stats }) {
  const lines = [];
  if (stats) {
    lines.push('【本月收支】');
    lines.push(`支出 ${stats.totals.out.toFixed(2)} 元，收入 ${stats.totals.in.toFixed(2)} 元，结余 ${(stats.totals.in - stats.totals.out).toFixed(2)} 元`);
    lines.push('【支出构成】');
    stats.catList.slice(0, 12).forEach((c) => lines.push(`${c.name}: ${c.value.toFixed(2)} 元`));
    if (stats.incomeList && stats.incomeList.length) {
      lines.push('【收入构成】');
      stats.incomeList.forEach((c) => lines.push(`${c.name}: ${c.value.toFixed(2)} 元`));
    }
    lines.push('【消费最多的商家】');
    stats.topMerchants.slice(0, 8).forEach((m) => lines.push(`${m.name}: ${m.value.toFixed(2)} 元`));
  }
  if (entries && entries.length) {
    lines.push('\n【近期日记】');
    entries.slice(0, 20).forEach((e) => {
      lines.push(`${e.entry_date} ${e.title || ''}${e.mood ? `[心情:${e.mood}]` : ''}`);
      lines.push(String(e.content || '').slice(0, 300));
    });
  }
  return lines.join('\n');
}

/* 流式对话 */
export async function chatStream({ messages, contextText, onDelta, signal }) {
  const model = await ensureModel();
  const system = `${SYSTEM_BASE}\n\n=== 用户数据 ===\n${contextText || '（暂无数据）'}`;
  const payload = [{ role: 'system', content: system }, ...messages];
  let full = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model,
    messages: payload,
    stream: true,
    temperature: 0.7,
    signal
  })) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      full += delta.content;
      onDelta(delta.content);
    }
  }
  return full;
}

/* 通用流式：system 由调用方给。八字节气问答走这里，不注入账本数据。 */
export async function streamWithSystem({ system, messages, onDelta, signal, temperature = 0.6 }) {
  const model = await ensureModel();
  const payload = [{ role: 'system', content: system }, ...messages];
  let full = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model,
    messages: payload,
    stream: true,
    temperature,
    signal
  })) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      full += delta.content;
      onDelta(delta.content);
    }
  }
  return full;
}

/* 非流式封装：用于分类、总结（内部仍走 stream） */
async function complete(messages, { fast = false, timeoutMs = 0 } = {}) {
  const model = fast ? await ensureFastModel() : await ensureModel();
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  let text = '';
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature: 0.2,
      ...(controller ? { signal: controller.signal } : {})
    })) {
      const d = chunk.choices?.[0]?.delta;
      if (d?.content) text += d.content;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  return text;
}

/* AI 批量分类交易 */
export async function categorizeWithAI(records, knownCategories) {
  if (!records.length) return [];
  const chunkSize = 40;
  const results = [];
  for (let i = 0; i < records.length; i += chunkSize) {
    const batch = records.slice(i, i + chunkSize);
    const lines = batch
      .map((r, idx) => `${idx + 1}. 商户="${r.merchant}" 说明="${r.description || ''}" 金额=${r.amount} 方向=${r.direction === 'in' ? '收入' : '支出'}`)
      .join('\n');
    const prompt = `把下面每笔交易归类到给定分类之一。可选分类：${knownCategories.join('、')}。
注意：方向=收入的交易只能归到 工资/奖金/租金/报销/理财/其他收入 中的一个。
只输出 JSON 数组，格式 [{"i":1,"c":"餐饮"}]，不要解释，不要代码块。

${lines}`;
    const text = await complete([
      { role: 'system', content: '你是消费账单分类器，只输出 JSON 数组。' },
      { role: 'user', content: prompt }
    ]);
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) {
      results.push(...batch);
      continue;
    }
    let arr = [];
    try {
      arr = JSON.parse(m[0]);
    } catch (e) {
      arr = [];
    }
    batch.forEach((r, idx) => {
      const hit = arr.find((a) => Number(a.i) === idx + 1);
      results.push(hit && knownCategories.includes(hit.c) ? { ...r, category: hit.c, ai: true } : r);
    });
  }
  return results;
}

/* 生成今日/本周小结 */
export async function summarize({ entries, stats, rangeLabel }) {
  const ctx = await buildContextData({ entries, stats });
  const text = await complete([
    { role: 'system', content: SYSTEM_BASE },
    {
      role: 'user',
      content: `请为「${rangeLabel}」写一段小结，包含：1) 生活状态与情绪 2) 钱财去向与异常消费 3) 一句具体建议。总字数 200 字以内。\n\n${ctx}`
    }
  ]);
  return text.trim();
}

/* ---------- 日记提炼 ---------- */

const DIGEST_SYSTEM = `你是日记整理助手。你的唯一任务是把用户写的一篇日记整理成结构化摘要，方便日后回顾。
硬性要求：
1. 只做提炼，绝不改写、续写、评价用户的内容，不加入原文没有的事实。
2. 全部用中文，语气平实。
3. 严格只输出一个 JSON 对象，不要代码块、不要任何解释文字。`;

const DIGEST_SCHEMA = `输出格式：
{
  "summary": "2-3 句话说清这篇日记主要讲了什么",
  "points": ["要点1", "要点2", "要点3"],
  "topics": ["主题词1", "主题词2"],
  "mood": "happy|calm|tired|sad|anxious|null",
  "todos": ["文中提到的待办或计划，没有就空数组"],
  "people": ["文中提到的人，没有就空数组"],
  "money": "文中提到的金钱事项（金额/花费/收入），没有就空字符串",
  "title": "如果原文没有标题，可给一个 8 字以内的标题；有标题就原样返回"
}
说明：
- points 是这篇日记里最值得记住的具体事实（谁、做了什么、结果如何），3-6 条，每条一行、20 字以内，不要空话。
- topics 是 2-5 个名词性主题词，用于日后检索。
- mood 只能从给定枚举里选一个，判断不出来用 null。`;

/* 从模型输出里尽力取出 JSON 对象 */
function pickJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function asList(v, max = 8) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x == null ? '' : x).trim())
    .filter(Boolean)
    .slice(0, max);
}

const MOOD_KEYS = ['happy', 'calm', 'tired', 'sad', 'anxious'];

/**
 * 提炼一篇日记。只读取 content，返回结构化结果，不修改原文。
 * @returns {Promise<{summary:string, points:string[], topics:string[], mood:string|null, todos:string[], people:string[], money:string, title:string}>}
 */
export async function digestEntry({ title, content, entry_date }) {
  const raw = String(content || '').trim();
  if (raw.length < 4) throw new Error('内容太短，写几句再提炼');
  // 控制 token：超长日记截断，但只影响送给模型的部分，原文不动
  const body = raw.length > 4000 ? raw.slice(0, 4000) + '\n……（后文过长已省略）' : raw;

  const text = await complete(
    [
      { role: 'system', content: DIGEST_SYSTEM },
      {
        role: 'user',
        content: `日期：${entry_date || ''}\n标题：${title || '（无）'}\n正文：\n${body}\n\n${DIGEST_SCHEMA}`
      }
    ],
    { fast: true, timeoutMs: 60000 }
  ).catch((e) => {
    if (e?.name === 'AbortError') throw new Error('提炼超时，请稍后重试');
    throw e;
  });

  const j = pickJson(text);
  if (!j) throw new Error('提炼结果解析失败，请重试');

  const mood = typeof j.mood === 'string' && MOOD_KEYS.includes(j.mood) ? j.mood : null;
  const summary = String(j.summary || '').trim();
  if (!summary) throw new Error('提炼结果为空，请重试');

  return {
    summary,
    points: asList(j.points, 6),
    topics: asList(j.topics, 5),
    mood,
    todos: asList(j.todos, 5),
    people: asList(j.people, 5),
    money: String(j.money || '').trim(),
    title: String(j.title || '').trim()
  };
}
