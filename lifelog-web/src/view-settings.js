import { h, render, toast, state, ask } from './store.js';
import { getSelfProfile, saveSelfProfile, loadRules } from './cloud.js';
import { ensureModel, modelLabel } from './ai.js';
import {
  PLATFORM,
  PLATFORM_LABEL,
  authFeatures,
  runtime,
  restoreTables,
  invalidateAll,
  ALL_TABLES,
  accountEmail,
  changePassword,
  changeEmail,
  regenerateRecovery,
  IDLE_LIMIT_MS
} from '@platform';

import { collectAll, download, stamp, entriesCsv, txCsv, toPlainText } from './exporter.js';
import { toResearchMarkdown, DECISION_TAG } from './research-export.js';

/* 设置页（整理版）
   原版的「邮箱密码登录 / 修改密码 / 10 分钟自动登出」都依附在 WorkBuddy 云账号上，
   现在按平台区分：claude.ai 版 / WorkBuddy 版，登录与存储由 @platform 提供。 */

/* ---------- 昵称 ---------- */

let idState = { open: false, name: '', busy: false, err: '', loaded: false };

async function openIdentity() {
  idState.open = true;
  idState.err = '';
  render();
  if (idState.loaded) return;
  try {
    const row = await getSelfProfile();
    const data = row?.data || {};
    const u = state.session?.user || {};
    idState.name = data.name || u.name || '';
  } catch (e) {
    idState.name = idState.name || state.session?.user?.name || '';
  }
  idState.loaded = true;
  render();
}

async function saveIdentity() {
  const name = idState.name.trim();
  idState.busy = true;
  idState.err = '';
  render();
  try {
    const row = await getSelfProfile();
    const base = row?.data || {};
    await saveSelfProfile({ ...base, name: name || base.name || '' });
    if (state.session?.user && name) state.session.user.name = name;
    idState.open = false;
    toast('昵称已更新');
  } catch (e) {
    idState.err = '保存失败：' + (e.message || e);
  }
  idState.busy = false;
  render();
}

/* 启动时用档案里的昵称覆盖账号名（如果设过） */
export async function applyNickname() {
  try {
    const row = await getSelfProfile();
    const nm = row?.data?.name;
    if (nm && state.session?.user) {
      state.session.user.name = nm;
      render();
    }
  } catch (e) {
    /* 忽略 */
  }
}

function identityCard() {
  if (!idState.open) {
    return h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn btn-sm btn-ghost', onclick: openIdentity }, '修改昵称'));
  }
  return h(
    'div',
    { style: 'margin-top:14px;max-width:360px' },
    h('input', {
      class: 'input',
      id: 'id-name',
      placeholder: '显示昵称',
      value: idState.name,
      oninput: (ev) => {
        idState.name = ev.target.value;
        idState.err = '';
      },
      onkeydown: (ev) => {
        if (ev.key === 'Enter') saveIdentity();
      }
    }),
    h('div', { class: 'err', style: 'font-size:12px' }, idState.err),
    h(
      'div',
      { class: 'row', style: 'gap:8px;margin-top:4px' },
      h('button', { class: 'btn btn-sm', disabled: idState.busy, onclick: saveIdentity }, idState.busy ? h('span', { class: 'spinner spinner-sm' }) : '保存'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { idState.open = false; render(); } }, '取消')
    )
  );
}

/* ---------- 登录与安全 ---------- */

let sec = { open: '', old: '', p1: '', p2: '', email: '', busy: false, err: '', code: '' };

function secSet(patch) {
  Object.assign(sec, patch);
  render();
}

function secInput(id, key, placeholder, type = 'password') {
  return h('input', {
    class: 'input',
    id,
    type,
    placeholder,
    autocomplete: type === 'password' ? 'off' : 'email',
    value: sec[key],
    style: 'margin-bottom:8px',
    oninput: (ev) => {
      sec[key] = ev.target.value;
      sec.err = '';
    }
  });
}

async function secRun(fn) {
  if (sec.busy) return;
  secSet({ busy: true, err: '' });
  try {
    await fn();
  } catch (e) {
    sec.err = (e && e.message) || String(e);
  }
  sec.busy = false;
  render();
}

function secForm() {
  const foot = (label, fn) =>
    h(
      'div',
      { class: 'row', style: 'gap:8px;margin-top:2px' },
      h('button', { class: 'btn btn-sm', disabled: sec.busy, onclick: fn }, sec.busy ? h('span', { class: 'spinner spinner-sm' }) : label),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => secSet({ open: '', err: '' }) }, '取消')
    );
  if (sec.open === 'pass') {
    return h(
      'div',
      { style: 'margin-top:12px;max-width:360px' },
      secInput('sec-old', 'old', '当前密码'),
      secInput('sec-p1', 'p1', '新密码（至少 6 位）'),
      secInput('sec-p2', 'p2', '再输入一次'),
      foot('保存新密码', () =>
        secRun(async () => {
          if (sec.p1 !== sec.p2) throw new Error('两次输入的新密码不一致');
          await changePassword(sec.old, sec.p1);
          sec = { ...sec, open: '', old: '', p1: '', p2: '' };
          toast('密码已更新');
        })
      )
    );
  }
  if (sec.open === 'email') {
    return h(
      'div',
      { style: 'margin-top:12px;max-width:360px' },
      secInput('sec-email', 'email', '新的登录邮箱', 'email'),
      secInput('sec-old2', 'old', '当前密码'),
      foot('保存邮箱', () =>
        secRun(async () => {
          await changeEmail(sec.old, sec.email);
          if (state.session?.user) state.session.user.email = accountEmail();
          sec = { ...sec, open: '', old: '', email: '' };
          toast('登录邮箱已更新');
        })
      )
    );
  }
  if (sec.open === 'code') {
    return h(
      'div',
      { style: 'margin-top:12px;max-width:360px' },
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, '生成新的恢复码后，旧的立即作废。'),
      secInput('sec-old3', 'old', '当前密码'),
      foot('生成新恢复码', () =>
        secRun(async () => {
          const code = await regenerateRecovery(sec.old);
          sec = { ...sec, open: '', old: '', code };
        })
      )
    );
  }
  return null;
}

function securityCard() {
  const row = (title, sub, key, label) =>
    h(
      'div',
      { class: 'row-between', style: 'padding:10px 0;border-top:1px solid var(--line);gap:10px' },
      h('div', { style: 'min-width:0' }, h('div', { style: 'font-size:13px;font-weight:500' }, title), h('div', { class: 'muted', style: 'font-size:12px;word-break:break-all' }, sub)),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => secSet({ open: sec.open === key ? '' : key, err: '', code: '' }) }, sec.open === key ? '收起' : label)
    );
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '登录与安全'),
    authFeatures.changeEmail ? row('登录邮箱', accountEmail(), 'email', '修改') : h('div', { class: 'row-between', style: 'padding:10px 0;border-top:1px solid var(--line)' }, h('div', {}, h('div', { style: 'font-size:13px;font-weight:500' }, '登录邮箱'), h('div', { class: 'muted', style: 'font-size:12px;word-break:break-all' }, accountEmail() || '—'))),
    row('登录密码', '••••••', 'pass', '修改密码'),
    authFeatures.recoveryCode ? row('恢复码', '忘记密码时用来重设', 'code', '重新生成') : null,
    secForm(),
    sec.err ? h('div', { class: 'err' }, sec.err) : null,
    sec.code
      ? h(
          'div',
          { style: 'margin-top:12px;max-width:360px' },
          h('div', { style: 'font-size:13px;font-weight:500' }, '新的恢复码（只显示这一次，请保存好）'),
          h('div', { class: 'recovery-code' }, sec.code),
          h('button', { class: 'btn btn-sm btn-ghost', style: 'margin-top:8px', onclick: () => secSet({ code: '' }) }, '我已保存')
        )
      : null,
    h(
      'div',
      { class: 'row-between', style: 'padding-top:12px;border-top:1px solid var(--line);margin-top:4px;gap:10px' },
      h('div', { class: 'muted', style: 'font-size:12px;line-height:1.7' }, `登录只在这台设备有效，连续 ${IDLE_LIMIT_MS / 60000} 分钟没有操作会自动退出。`),
      h(
        'button',
        {
          class: 'btn btn-sm btn-ghost',
          onclick: () => window.dispatchEvent(new CustomEvent('lifelog-signout'))
        },
        '退出登录'
      )
    )
  );
}

/* ---------- 存储状态 ---------- */

function storageCard() {
  const cloudMode = runtime.mode === 'cloud';
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '数据存储', h('span', { class: 'store-badge' + (cloudMode ? ' ok' : '') }, cloudMode ? '● 云端同步' : '● 仅本机')),
    cloudMode && PLATFORM === 'workbuddy'
      ? h(
          'div',
          { class: 'muted', style: 'line-height:1.9' },
          '数据存在 WorkBuddy（腾讯）云数据库里，按账号隔离，只有你自己的账号能读写。国内可以直接访问。',
          h('br'),
          '手机和电脑登录同一个账号就是同一份数据。'
        )
      : cloudMode
      ? h(
          'div',
          { class: 'muted', style: 'line-height:1.9' },
          '数据存在你 Claude 账号下这个应用的私有空间里，只有你自己能读写——即使把链接分享给别人，对方也看不到你的任何记录。',
          h('br'),
          '手机和电脑打开同一个链接就是同一份数据；从后台切回来时会自动刷新。'
        )
      : h(
          'div',
          { class: 'muted', style: 'line-height:1.9' },
          '现在是本机模式：数据只保存在这个浏览器里，清浏览器数据就没了，AI 功能也不可用。',
          h('br'),
          '在 claude.ai 里打开这个应用（手机上用 Claude App 或浏览器均可），即可开启云端同步。'
        ),
    PLATFORM === 'workbuddy'
      ? null
      : h(
      'div',
      { class: 'row', style: 'gap:8px;margin-top:12px;flex-wrap:wrap' },
      h(
        'button',
        {
          class: 'btn btn-sm btn-ghost',
          onclick: () => {
            invalidateAll();
            toast('已刷新，切到别的页面会重新拉数据');
          }
        },
        '立即从云端刷新'
      )
    )
  );
}

/* ---------- 从备份恢复 ----------
   支持本应用导出的「完整备份 JSON」，也支持旧版（WorkBuddy 上的个人APP）导出的同格式文件——
   把旧网站上的数据搬过来就靠它。同 id 的记录会覆盖，不会重复。 */

let restoreState = { busy: false, msg: '' };

async function onRestoreFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let bundle;
  try {
    bundle = JSON.parse(await file.text());
  } catch (e) {
    toast('文件不是有效的 JSON', 'err');
    return;
  }
  const data = bundle && (bundle.data || bundle);
  if (!data || typeof data !== 'object') {
    toast('没在文件里找到数据', 'err');
    return;
  }
  const counts = ALL_TABLES.filter((t) => Array.isArray(data[t]) && data[t].length).map((t) => `${TABLE_NAMES[t] || t} ${data[t].length}`);
  if (!counts.length) {
    toast('备份里没有可恢复的记录', 'err');
    return;
  }
  const okGo = await ask('将恢复以下数据：\n' + counts.join('、') + '\n\n同一条记录会被备份里的版本覆盖，其余数据保留。继续？', { okText: '开始恢复', danger: false });
  if (!okGo) return;
  restoreState = { busy: true, msg: '正在写入…' };
  render();
  try {
    const report = await restoreTables(data, (t, n) => {
      restoreState.msg = `正在写入 ${TABLE_NAMES[t] || t}（${n} 条）…`;
      render();
    });
    await loadRules();
    const total = Object.values(report).reduce((a, b) => a + b, 0);
    restoreState = { busy: false, msg: `恢复完成，共 ${total} 条记录。` };
    toast('恢复完成');
  } catch (e) {
    restoreState = { busy: false, msg: '恢复失败：' + (e.message || e) };
  }
  render();
}

const TABLE_NAMES = {
  entries: '日记',
  todos: '待办',
  transactions: '账单',
  rules: '分类规则',
  goals: '目标',
  tasks: '任务/日程',
  budgets: '预算',
  accounts: '账户',
  birth_info: '生辰',
  people: '人物卡',
  self_profile: '本人档案',
  places: '位置',
  looks: '外形素材',
  bazi_qa: '八字问答'
};

function restoreCard() {
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '从备份恢复'),
    h(
      'div',
      { class: 'muted', style: 'line-height:1.8;margin-bottom:12px' },
      '选择之前导出的「完整备份 JSON」。旧网站（WorkBuddy 版）上的数据：先在旧网站的设置页导出完整备份，再在这里恢复即可搬过来。'
    ),
    h(
      'label',
      { class: 'btn btn-sm' + (restoreState.busy ? ' disabled' : ''), style: 'cursor:pointer;display:inline-flex;align-items:center;gap:6px' },
      restoreState.busy ? h('span', { class: 'spinner spinner-sm' }) : '选择备份文件…',
      h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', disabled: restoreState.busy, onchange: onRestoreFile })
    ),
    restoreState.msg ? h('div', { class: 'hint', style: 'margin-top:10px' }, restoreState.msg) : null
  );
}

export function settingsView() {
  const u = state.session?.user || {};
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '设置'), h('p', { class: 'desc' }, '账号、数据与手机使用'))),

    h(
      'div',
      { class: 'card' },
      h('h3', { class: 'card-title' }, '账号'),
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'avatar', style: 'width:40px;height:40px;font-size:15px' }, (u.name || '我').slice(0, 1)),
        h(
          'div',
          {},
          h('div', { style: 'font-weight:500' }, u.name || '我'),
          h('div', { class: 'muted' }, accountEmail() || '—')
        )
      ),
      identityCard()
    ),

    securityCard(),

    storageCard(),

    exportCard(),

    restoreCard(),

    installCard(),

    h(
      'div',
      { class: 'card' },
      h('h3', { class: 'card-title' }, 'AI 状态'),
      h(
        'div',
        { class: 'row-between' },
        h('div', { class: 'muted' }, state.aiOk ? `可用 · ${modelLabel()}` : runtime.aiAvailable ? (PLATFORM === 'claude' ? '首次使用 AI 时会请你授权' : '首次使用 AI 时自动连接') : '本机模式下不可用'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: testAI }, '检查')
      ),
      h(
        'div',
        { class: 'muted', style: 'font-size:12px;line-height:1.8;margin-top:10px' },
        PLATFORM === 'claude'
          ? 'AI 问答、日记提炼、账单分类、命理分析都用你自己的 Claude 额度。提问时会把相关的日记摘要和收支统计一起发给 Claude 作为参考，不会用于其他用途。'
          : 'AI 问答、日记提炼、账单分类、命理分析使用 WorkBuddy 提供的国产大模型（自动挑选可用的一个）。提问时会把相关的日记摘要和收支统计一起发给模型作为参考。'
      )
    ),

    h(
      'div',
      { class: 'card' },
      h('h3', { class: 'card-title' }, '使用建议'),
      h(
        'ul',
        { class: 'muted', style: 'line-height:2;margin:0;padding-left:18px' },
        h('li', {}, '每天睡前写三五行，比写长文章更容易坚持'),
        h('li', {}, '账单建议每月初导出上个月的，一次性导入'),
        h('li', {}, '给交易改分类后，同类商户下次会自动沿用'),
        h('li', {}, '用「问问账本」做月末复盘，比看数字更直观')
      )
    )
  );
}

/* ---------- 数据导出 ---------- */

let exportState = { busy: false, last: null, showText: false, text: '' };

function exportCard() {
  const busy = exportState.busy;
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '导出数据'),
    h(
      'div',
      { class: 'muted', style: 'line-height:1.8;margin-bottom:14px' },
      '把你的日记和账单完整导出，格式公开、不加密、不绑定本应用。换用其他 app 或 AI agent 时可以直接导入或投喂。'
    ),
    h(
      'div',
      { class: 'hint', style: 'line-height:1.8;margin-bottom:12px' },
      `做重要决定时写一篇日记、标签填「${DECISION_TAG}」，事后补上结果；「给 Claude 研究」会把它们单独列出来。`
    ),
    h(
      'div',
      { class: 'export-grid' },
      h(
        'button',
        { class: 'export-item', disabled: busy, onclick: () => doExport('research') },
        h('b', {}, '给 Claude 研究'),
        h('span', {}, '一份 Markdown：全部板块 + 按月汇总 + 决策记录，上传到 Claude 项目')
      ),
      h(
        'button',
        { class: 'export-item', disabled: busy, onclick: () => doExport('json') },
        h('b', {}, '完整备份 JSON'),
        h('span', {}, '全部数据 + 字段说明，最适合迁移到别的工具')
      ),
      h(
        'button',
        { class: 'export-item', disabled: busy, onclick: () => doExport('csv') },
        h('b', {}, '表格 CSV'),
        h('span', {}, '日记、账单各一份，Excel / Numbers 直接打开')
      ),
      h(
        'button',
        { class: 'export-item', disabled: busy, onclick: () => doExport('text') },
        h('b', {}, '纯文本'),
        h('span', {}, '一段话就能贴给任何 AI 助手读')
      )
    ),
    busy ? h('div', { class: 'muted', style: 'margin-top:12px;font-size:12.5px' }, h('span', { class: 'spinner spinner-sm' }), ' 正在整理全部数据…') : null,
    exportState.last
      ? h(
          'p',
          { class: 'hint', style: 'margin-top:12px' },
          `上次导出：${exportState.last}`
        )
      : null,
    exportState.showText
      ? h(
          'div',
          { style: 'margin-top:14px' },
          h(
            'div',
            { class: 'row-between', style: 'margin-bottom:6px' },
            h('span', { class: 'muted', style: 'font-size:12px' }, '内容预览（可全选复制）'),
            h(
              'button',
              {
                class: 'btn btn-sm btn-ghost',
                onclick: async () => {
                  try {
                    await navigator.clipboard.writeText(exportState.text);
                    toast('已复制到剪贴板');
                  } catch (e) {
                    toast('复制失败，请手动选中复制', 'err');
                  }
                }
              },
              '复制全文'
            )
          ),
          h('textarea', {
            class: 'export-preview',
            readonly: 'readonly',
            value: exportState.text.slice(0, 20000),
            onfocus: (ev) => ev.target.select()
          })
        )
      : null
  );
}

async function doExport(kind) {
  if (exportState.busy) return;
  exportState.busy = true;
  render();
  try {
    const bundle = await collectAll();
    if (!Object.values(bundle.counts).some((n) => n > 0)) {
      toast('还没有可导出的数据', 'err');
      exportState.busy = false;
      render();
      return;
    }
    const ts = stamp();
    if (kind === 'json') {
      await download(`个人APP-全量备份-${ts}.json`, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8');
    } else if (kind === 'csv') {
      await download(`个人APP-日记-${ts}.csv`, entriesCsv(bundle.data.entries), 'text/csv;charset=utf-8');
      // 两个文件连续下载，错开一点避免浏览器拦截
      await new Promise((r) => setTimeout(r, 400));
      await download(`个人APP-账单-${ts}.csv`, txCsv(bundle.data.transactions), 'text/csv;charset=utf-8');
    } else if (kind === 'research') {
      const month = new Date().toISOString().slice(0, 7);
      await download(`个人APP-研究资料-${month}.md`, toResearchMarkdown(bundle), 'text/markdown;charset=utf-8');
    } else {
      const text = toPlainText(bundle);
      exportState.text = text;
      exportState.showText = true;
      await download(`个人APP-纯文本-${ts}.txt`, text, 'text/plain;charset=utf-8');
    }
    exportState.last = new Date().toLocaleString('zh-CN');
    toast(`导出完成：日记 ${bundle.counts.entries} 篇，账单 ${bundle.counts.transactions} 笔`);
  } catch (e) {
    toast('导出失败：' + (e.message || e), 'err');
  } finally {
    exportState.busy = false;
    render();
  }
}

/* ---------- 装到手机 ---------- */

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function step(n, text) {
  return h('div', { class: 'ins-step' }, h('span', { class: 'ins-n' }, String(n)), h('span', {}, text));
}

const WB_URL = 'https://life-ledger-17434.app.workbuddy.host/';

function wbInstallCard() {
  const ios = isIOS();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(WB_URL);
      toast('链接已复制');
    } catch (e) {
      toast('复制失败，请长按链接手动复制', 'err');
    }
  };
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '在手机 / 微信里用'),
    h('div', { class: 'muted', style: 'line-height:1.8;margin-bottom:12px' }, '不需要下载安装，国内直接打开。加到主屏幕后点图标就是全屏，跟普通 App 一样。'),
    h('div', { class: 'ins-url' }, h('span', { class: 'ins-url-t' }, WB_URL), h('button', { class: 'btn btn-sm btn-ghost', onclick: copy }, '复制链接')),
    h('div', { style: 'font-size:13px;font-weight:500;margin:14px 0 8px' }, ios ? 'iPhone：Safari 加到主屏幕' : '安卓：浏览器加到主屏幕'),
    ios
      ? h('div', {}, step(1, '用 Safari 打开上面的网址'), step(2, '点底部「分享」按钮（方框 + 向上箭头）'), step(3, '选「添加到主屏幕」，再点「添加」'))
      : h('div', {}, step(1, '用 Chrome / 系统浏览器打开上面的网址'), step(2, '点右上角「⋮」菜单'), step(3, '选「添加到主屏幕」或「安装应用」')),
    h(
      'div',
      { class: 'muted', style: 'font-size:12px;line-height:1.8;margin-top:12px' },
      '微信里：把链接发给「文件传输助手」，点开就能用。想加到桌面，先点右上角「…」→「在浏览器打开」。'
    )
  );
}

function installCard() {
  if (PLATFORM === 'workbuddy') return wbInstallCard();
  const ios = isIOS();
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '在手机上用'),
    h(
      'div',
      { class: 'muted', style: 'line-height:1.8;margin-bottom:12px' },
      '不需要下载安装。这个应用的链接在手机上打开就能用，数据和电脑上是同一份。'
    ),
    h('div', { style: 'font-size:13px;font-weight:500;margin-bottom:8px' }, '方法一：Claude App（推荐）'),
    step(1, '手机上装好 Claude App 并登录同一个账号'),
    step(2, '在 Claude 里打开「Artifacts / 作品」列表，找到「个人APP」，或者直接点这个应用的链接'),
    step(3, '可以把它置顶（Pin），下次一点就开'),
    h('div', { style: 'font-size:13px;font-weight:500;margin:14px 0 8px' }, ios ? '方法二：Safari 加到主屏幕' : '方法二：浏览器加到主屏幕'),
    ios
      ? h(
          'div',
          {},
          step(1, '用 Safari 打开这个应用的链接，登录 claude.ai'),
          step(2, '点底部「分享」按钮（方框 + 向上箭头）'),
          step(3, '选「添加到主屏幕」，桌面上就有一个图标')
        )
      : h(
          'div',
          {},
          step(1, '用 Chrome 打开这个应用的链接，登录 claude.ai'),
          step(2, '点右上角「⋮」菜单'),
          step(3, '选「添加到主屏幕」')
        ),
    h(
      'div',
      { class: 'muted', style: 'font-size:12px;line-height:1.8;margin-top:12px' },
      '微信里的内置浏览器登录不了 claude.ai，请点右上角「…」→「在浏览器打开」。'
    )
  );
}

async function testAI() {
  try {
    const m = await ensureModel();
    if (m) {
      state.aiOk = true;
      toast('AI 可用：' + modelLabel());
      render();
    }
  } catch (e) {
    toast('AI 不可用：' + (e.message || e), 'err');
  }
}
