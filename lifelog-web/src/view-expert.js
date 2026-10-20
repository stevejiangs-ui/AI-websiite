/* 专家对话页：每位专家有独立的 system 提示和自己的数据源。
   与「问问账本」分开——那边是通用问答，这里是带着角色和数据的专业对话。 */

import { h, render, toast, state, setState } from './store.js';
import { streamWithSystem, ensureModel, buildContextData } from './ai.js';
import { listEntries, listTransactions, computeStats, listGoals, listPeople } from './cloud.js';
import { EXPERTS, expertOf } from './experts.js';
import { ensureBirth } from './view-fortune.js';
import { baziOf, dailyFortune } from './bazi.js';
import { favorableGods, periodFortune, applyAdvice } from './yongshen.js';

let drafts = '';
let controller = null;

/* 每位专家独立的消息历史，切专家不串台 */
function msgsOf(id) {
  if (!state.expertMsgs) state.expertMsgs = {};
  if (!state.expertMsgs[id]) state.expertMsgs[id] = [];
  return state.expertMsgs[id];
}

export function openExpert(id) {
  const e = expertOf(id);
  if (!e) return;
  setState({ view: 'expert', expertId: id });
  ensureModel()
    .then(() => {
      state.aiOk = true;
    })
    .catch(() => {
      state.aiOk = false;
    });
  loadExpertData(id)
    .then((ctx) => {
      state.expertCtx = { id, text: ctx };
      render();
    })
    .catch(() => {
      state.expertCtx = { id, text: '（数据读取失败，请基于一般常识回答）' };
    });
}

/* 按专家类型拉数据上下文 */
async function loadExpertData(id) {
  const e = expertOf(id);
  if (!e || e.data === 'none') return '（本次对话没有附加个人数据）';

  if (e.data === 'finance') {
    const month = new Date().toISOString().slice(0, 7);
    const tx = await listTransactions({ month, limit: 300 });
    const stats = computeStats(tx || []);
    const base = await buildContextData({ entries: [], stats, month });

    /* 收入四分法 + 负债：用户要求分开看工作/物业/投资/负债，
       财务师看到的结构必须跟财务页一致。 */
    let extra = '';
    try {
      const { incomeMix, debtSummary } = await import('./view-income.js');
      const { listAllTransactions, listAccounts } = await import('./finance.js');
      const [all, accounts] = await Promise.all([listAllTransactions(2000), listAccounts()]);
      const mix = incomeMix(all, month);
      const debt = debtSummary(accounts);
      extra = [
        '',
        '———————— 收入四分法（与财务页一致）————————',
        `本月收入合计：${mix.total}`,
        ...mix.groups.map(
          (g) => `${g.label}：${g.amount}（占 ${g.share}%${g.mom != null ? `，环比 ${g.mom >= 0 ? '+' : ''}${g.mom}%` : ''}${g.stable ? '，稳定' : ''}）`
        ),
        `被动收入（物业+投资）占比：${mix.passivePct}%（${mix.passive}）`,
        '',
        '———————— 负债 ————————',
        debt.list.length ? debt.list.map((a) => `${a.name}：${Math.abs(Number(a.balance) || 0)}`).join('；') : '（无登记负债）',
        `负债合计 ${debt.total}，资产合计 ${debt.assets}，净资产 ${debt.net}${debt.ratio != null ? `，负债率 ${debt.ratio}%` : ''}`
      ].join('\n');
    } catch (err) {
      extra = '';
    }

    return base + extra;
  }

  /* 圈子：把人物卡作为背景，但带 not_mention 的人一律不进上下文 —— 用户
     勾了那个标记就是不想被 AI 提起，连「有这个人」都不该泄露。 */
  if (e.data === 'people') {
    try {
      const list = await listPeople();
      const visible = (list || []).filter((p) => !p.not_mention);
      const hidden = (list || []).length - visible.length;
      if (!visible.length) return '（用户还没有登记可引用的人物信息）';
      const lines = visible.map((p) =>
        [
          `- ${p.name}（${p.relation_label || p.relation}，亲密度 ${p.closeness}/5）`,
          p.likes ? `喜欢：${p.likes}` : '',
          p.dislikes ? `不喜欢：${p.dislikes}` : '',
          p.hobbies ? `爱好：${p.hobbies}` : '',
          p.notes ? `备注：${p.notes}` : '',
          p.last_contact ? `最近联系：${p.last_contact}` : ''
        ]
          .filter(Boolean)
          .join('；')
      );
      return (
        '用户的人际圈子（仅在对方主动问到时引用，不要主动提名字）：\n' +
        lines.join('\n') +
        (hidden ? `\n（另有 ${hidden} 位被用户标记为「不要提起」，已从上下文移除，不要推测或询问。）` : '')
      );
    } catch (err) {
      return '（人物信息读取失败）';
    }
  }

  if (e.data === 'diary' || e.data === 'all') {
    const month = new Date().toISOString().slice(0, 7);
    const [entries, tx] = await Promise.all([
      listEntries({ limit: 40 }),
      e.data === 'all' ? listTransactions({ month, limit: 200 }) : Promise.resolve([])
    ]);
    const stats = tx.length ? computeStats(tx) : null;
    return await buildContextData({ entries: entries || [], stats, month });
  }

  if (e.data === 'goals') {
    const goals = await listGoals();
    const lines = (goals || [])
      .filter((g) => g.status !== 'done')
      .map(
        (g) =>
          `- 【${g.title}】进度 ${g.progress}%${g.target_date ? '，截止 ' + g.target_date : ''}${g.detail ? '；备注：' + g.detail : ''}`
      );
    return '当前进行中的目标：\n' + (lines.length ? lines.join('\n') : '（暂无进行中的目标）');
  }

  if (e.data === 'bazi') {
    const b = ensureBirth();
    if (!b || !b.year) return '（用户尚未填写出生时间。请引导：回到「八字」页点「填生辰八字」，填公历出生时间和出生地。）';
    const c = baziOf(b);
    const pillars = c.pillars.map((p) => `${p.label} ${p.gan}${p.zhi}（藏干 ${p.cang.join('/')}）`).join('；');
    const wx = Object.entries(c.wuxing)
      .map(([k, v]) => `${k} ${v}`)
      .join('，');

    /* 喜用神与三级运势：这是用户明确要求写进八字里的内容，
       命理师必须看到同一套结论，否则会跟你自己看到的页面打架。 */
    let ys = '';
    let pf = '';
    try {
      const fg = favorableGods(c);
      const f = dailyFortune(new Date());
      const p = periodFortune(fg, c.dayMaster, { yearGz: f.yearGz, monthGz: f.monthGz, dayGz: f.dayGz }, c);
      ys = [
        `———————— 系统推算的喜用神（扶抑法，已与页面一致）————————`,
        `旺衰判定：${fg.verdict}（扶身之力 ${fg.supportPct}%；得令=${fg.deLing ? '是' : '否'}，得地=${fg.deDi ? '是' : '否'}）`,
        `五行占比（月令加权）：${Object.entries(fg.pct).map(([k, v]) => `${k}${v}%`).join('，')}`,
        `用神：${fg.useful.map((u) => `${u.wx}（${u.role}）`).join('、')}`,
        fg.favorable.length ? `喜神：${fg.favorable.map((u) => `${u.wx}（${u.role}）`).join('、')}` : '喜神：无',
        `忌神：${fg.avoid.map((u) => `${u.wx}（${u.role}）`).join('、')}`,
        `推断依据：${fg.reasoning.join(' ')}`,
        `已给出的生活建议：${applyAdvice(fg).map((a) => `【${a.title}】${a.text}`).join(' ')}`,
        ``,
        `———————— 当前时间三级运势 ————————`,
        `流年 ${p.year.gz}：${p.year.grade}（十神 ${p.year.shishen || '—'}）`,
        `流月 ${p.month.gz}：${p.month.grade}（十神 ${p.month.shishen || '—'}）`,
        `流日 ${p.day.gz}：${p.day.grade}（十神 ${p.day.shishen || '—'}）`,
        `总评：${p.summary}`,
        `宜：${p.yi.join('、') || '—'}`,
        `忌：${p.ji.join('、') || '—'}`,
        p.cautions.length ? `注意：${p.cautions.join(' ')}` : '',
        ``,
        `（以上是系统算出的结论。请在此基础上解读，不要另起一套算法；如果与你的判断不同，说明分歧点在哪里。）`
      ]
        .filter(Boolean)
        .join('\n');
    } catch (err) {
      ys = '（喜用神推算失败，请基于四柱自行判断旺衰取用。）';
    }

    return [
      `出生：${b.year}-${b.month}-${b.day} ${String(b.hour).padStart(2, '0')}:${String(b.minute).padStart(2, '0')}（公历）`,
      b.place ? `出生地：${b.place}（东经 ${b.lon}°）` : '',
      c.usedTrueSolar
        ? `真太阳时 ${c.trueSolarHour.toFixed(2)} 时（校正 ${c.solarOffsetMin} 分）`
        : '未做真太阳时校正',
      `四柱：${pillars}`,
      `日主：${c.dayMaster}（${c.dayMasterWuxing}），${c.strengthLabel}（同类占比 ${Math.round(c.strength * 100)}%）`,
      `五行分布：${wx}；最旺 ${c.strongest[0]}，最弱 ${c.weakest[0]}`,
      `十神：${c.shishen.map((s) => `${s.label} ${s.gan}=${s.god}`).join('，')}`,
      `所属年相：${c.solarYear} 年，属${c.animal}`,
      '',
      ys
    ]
      .filter(Boolean)
      .join('\n');
  }

  return '（本次对话没有附加个人数据）';
}

export function expertView() {
  const e = expertOf(state.expertId) || EXPERTS[0];
  const msgs = msgsOf(e.id);
  const ready = state.expertCtx && state.expertCtx.id === e.id;

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h(
          'h1',
          {},
          h('span', { style: 'margin-right:8px' }, e.emoji),
          e.name
        ),
        h('p', { class: 'desc' }, e.desc + (ready ? '' : ' · 正在读取你的数据…'))
      ),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'button',
          { class: 'btn btn-sm btn-ghost', onclick: () => setState({ expertPicker: !state.expertPicker }) },
          '换专家'
        ),
        msgs.length
          ? h(
              'button',
              {
                class: 'btn btn-sm btn-ghost',
                onclick: () => {
                  state.expertMsgs[e.id] = [];
                  render();
                }
              },
              '清空对话'
            )
          : null
      )
    ),

    /* 专家切换条 */
    state.expertPicker
      ? h(
          'div',
          { class: 'expert-picker' },
          ...EXPERTS.map((x) =>
            h(
              'button',
              {
                class: 'expert-chip' + (x.id === e.id ? ' on' : ''),
                onclick: () => {
                  setState({ expertPicker: false });
                  openExpert(x.id);
                }
              },
              h('span', { class: 'em' }, x.emoji),
              h('span', {}, x.name),
              h('span', { class: 'muted', style: 'font-size:11px' }, x.tip)
            )
          )
        )
      : null,

    h(
      'div',
      { class: 'chat-box' },
      h(
        'div',
        { class: 'chat-log', id: 'chat-log' },
        msgs.length
          ? [...msgs.map((m) => msgNode(m, e)), ...(state.chatBusy ? [thinkingNode(e)] : [])]
          : h(
              'div',
              { class: 'empty', style: 'padding:36px 20px' },
              h('div', { class: 'big' }, e.emoji),
              h('p', {}, `我是你的${e.name}，${e.desc}。`),
              h(
                'div',
                { class: 'suggests', style: 'justify-content:center' },
                ...e.suggests.map((s) => h('button', { class: 'suggest', onclick: () => send(s) }, s))
              )
            )
      ),
      h(
        'div',
        { class: 'chat-input' },
        h('textarea', {
          id: 'chat-text',
          placeholder: `和${e.name}说点什么…（Enter 发送）`,
          value: drafts,
          rows: 1,
          oninput: (ev) => {
            drafts = ev.target.value;
          },
          onkeydown: (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              send(drafts);
            }
          }
        }),
        state.chatBusy
          ? h(
              'button',
              { class: 'btn btn-sm', onclick: () => controller?.abort() },
              '停止'
            )
          : h('button', { class: 'btn btn-sm btn-accent', onclick: () => send(drafts) }, '发送')
      )
    )
  );
}

function msgNode(m, e) {
  return h(
    'div',
    { class: 'msg ' + m.role },
    h('div', { class: 'msg-avatar' }, m.role === 'user' ? '我' : e.emoji),
    h('div', { class: 'bubble' + (m.streaming ? ' typing' : '') }, m.content)
  );
}

function thinkingNode(e) {
  return h(
    'div',
    { class: 'msg assistant' },
    h('div', { class: 'msg-avatar' }, e.emoji),
    h('div', { class: 'bubble typing' }, e.name + ' 正在看你的数据')
  );
}

export async function send(text) {
  const content = String(text || '').trim();
  if (!content || state.chatBusy) return;
  const e = expertOf(state.expertId);
  if (!e) return;

  drafts = '';
  const ta = document.getElementById('chat-text');
  if (ta) ta.value = '';

  const msgs = msgsOf(e.id);
  msgs.push({ role: 'user', content });
  msgs.push({ role: 'assistant', content: '', streaming: true });
  state.chatBusy = true;
  render();
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;

  controller = new AbortController();
  try {
    if (!state.expertCtx || state.expertCtx.id !== e.id) {
      state.expertCtx = { id: e.id, text: await loadExpertData(e.id) };
    }
    const history = msgs
      .filter((m) => !m.streaming)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

    const target = msgs[msgs.length - 1];
    await streamWithSystem({
      system: e.system + '\n\n--- 用户数据（仅供你参考，回答时引用）---\n' + (state.expertCtx?.text || ''),
      messages: history,
      signal: controller.signal,
      onDelta: (d) => {
        target.content += d;
        const el = document.getElementById('chat-log');
        if (el) {
          const bubbles = el.querySelectorAll('.msg.assistant .bubble');
          const last = bubbles[bubbles.length - 1];
          if (last) {
            last.textContent = target.content;
            el.scrollTop = el.scrollHeight;
          }
        }
      }
    });
    target.streaming = false;
  } catch (err) {
    const target = msgs[msgs.length - 1];
    if (err?.name === 'AbortError') {
      target.content = target.content || '（已停止）';
    } else {
      target.content = target.content
        ? target.content + '\n\n（生成中断：' + (err.message || err) + '）'
        : '出错了：' + (err.message || err);
    }
    target.streaming = false;
  } finally {
    state.chatBusy = false;
    controller = null;
    render();
    const el = document.getElementById('chat-log');
    if (el) el.scrollTop = el.scrollHeight;
  }
}
