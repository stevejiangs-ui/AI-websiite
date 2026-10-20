import { h, render, toast, state } from './store.js';
import { buildContextData, chatStream, ensureModel } from './ai.js';
import { listEntries, computeStats, listTransactions } from './cloud.js';

const SUGGESTS = [
  '这个月我的钱主要花在哪了？',
  '我的收入都来自哪里？租金占比多少？',
  '最近我的状态怎么样？',
  '帮我写一句这周的小结'
];

let drafts = '';
let controller = null;

export function chatView() {
  const msgs = state.chat;
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, '问问账本'), h('p', { class: 'desc' }, '基于你的日记和账单数据回答')),
      h(
        'div',
        { class: 'toolbar' },
        state.chat.length
          ? h(
              'button',
              {
                class: 'btn btn-sm btn-ghost',
                onclick: () => {
                  state.chat = [];
                  render();
                }
              },
              '清空对话'
            )
          : null
      )
    ),

    h(
      'div',
      { class: 'chat-box' },
      h(
        'div',
        { class: 'chat-log', id: 'chat-log' },
        msgs.length
          ? [...msgs.map(msgNode), ...(state.chatBusy ? [thinkingNode()] : [])]
          : h(
              'div',
              { class: 'empty', style: 'padding:40px 20px' },
              h('div', { class: 'big' }, '◌'),
              h('p', {}, '你的日记和账单，都可以直接问我。'),
              h(
                'div',
                { class: 'suggests', style: 'justify-content:center' },
                ...SUGGESTS.map((s) => h('button', { class: 'suggest', onclick: () => send(s) }, s))
              )
            )
      ),
      h(
        'div',
        { class: 'chat-input' },
        h('textarea', {
          id: 'chat-text',
          placeholder: '问点什么…（Enter 发送，Shift+Enter 换行）',
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
              {
                class: 'btn btn-sm',
                onclick: () => {
                  controller?.abort();
                }
              },
              '停止'
            )
          : h(
              'button',
              {
                class: 'btn btn-sm btn-accent',
                onclick: () => send(drafts)
              },
              '发送'
            )
      )
    )
  );
}

function msgNode(m) {
  return h(
    'div',
    { class: 'msg ' + m.role },
    h('div', { class: 'msg-avatar' }, m.role === 'user' ? '我' : 'AI'),
    h('div', { class: 'bubble' + (m.streaming ? ' typing' : '') }, m.content)
  );
}

function thinkingNode() {
  return h(
    'div',
    { class: 'msg assistant' },
    h('div', { class: 'msg-avatar' }, 'AI'),
    h('div', { class: 'bubble typing' }, '正在看你的数据')
  );
}

function scrollChat() {
  const el = document.getElementById('chat-log');
  if (el) el.scrollTop = el.scrollHeight;
}

async function buildCtx() {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const [entries, tx] = await Promise.all([listEntries({ limit: 20 }), listTransactions({ month, limit: 300 })]);
    const stats = computeStats(tx || []);
    return await buildContextData({ entries: entries || [], stats, month });
  } catch (e) {
    return '（数据读取失败，请基于一般常识回答）';
  }
}

export async function send(text) {
  const content = String(text || '').trim();
  if (!content || state.chatBusy) return;
  drafts = '';
  const ta = document.getElementById('chat-text');
  if (ta) ta.value = '';

  state.chat.push({ role: 'user', content });
  state.chat.push({ role: 'assistant', content: '', streaming: true });
  state.chatBusy = true;
  render();
  scrollChat();

  controller = new AbortController();
  try {
    const ctx = await buildCtx();
    const history = state.chat
      .filter((m) => !m.streaming)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    const target = state.chat[state.chat.length - 1];
    await chatStream({
      messages: history,
      contextText: ctx,
      signal: controller.signal,
      onDelta: (d) => {
        target.content += d;
        const log = document.getElementById('chat-log');
        if (log) {
          const bubbles = log.querySelectorAll('.msg.assistant .bubble');
          const last = bubbles[bubbles.length - 1];
          if (last) {
            last.textContent = target.content;
            log.scrollTop = log.scrollHeight;
          }
        }
      }
    });
    target.streaming = false;
  } catch (e) {
    const target = state.chat[state.chat.length - 1];
    if (e?.name === 'AbortError') {
      target.content = target.content || '（已停止）';
    } else {
      target.content = target.content
        ? target.content + '\n\n（生成中断：' + (e.message || e) + '）'
        : '出错了：' + (e.message || e);
    }
    target.streaming = false;
  } finally {
    state.chatBusy = false;
    controller = null;
    render();
    scrollChat();
  }
}
