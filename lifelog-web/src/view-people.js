/* 我的圈子 —— 人物信息卡
   ------------------------------------------------------------------
   用户要的是「把本人、亲人、朋友、不喜欢的人的信息、爱好做成信息卡」。

   三个设计上的取舍（都已跟用户确认）：
     1. 分类分开：亲人 / 朋友 / 同事 / 不喜欢的人 / 其他，不混在一个列表里，
        因为「不喜欢的人」出现在亲人堆里，观感很差。
     2. 敏感标记双层：
          sensitive   → 界面默认折叠，点开才看（防被瞥见）
          not_mention → 问 AI 时不主动提这个人（防说漏嘴）
        两个意思不一样，不合并。
     3. 亲密度 1–5，只用来排序和显示，不做任何自动推断。

   「本人」用关系 kind = self，单独排在第一位。
*/

import { h, render, toast, state, setState, todayStr, ask } from './store.js';
import { listPeople, savePerson, deletePerson, getSelfProfile, saveSelfProfile, RELATION_KINDS, relationLabel } from './cloud.js';
/* 八字十神相关已整体搬到「八字」页（view-bazi-self），这里不再引用。 */

/* 本人基本资料（self_profile 表，JSON 键值）。
   必须声明在使用它的 loadPeople 之前，否则首次进人物页会撞上暂时性死区。 */
let selfProfileData = {};

/* 本人卡单独存一条，relation = 'self' */
const SELF_KIND = { k: 'self', label: '本人', color: '#b5762a' };

let peopleLoading = null;

export async function loadPeople() {
  if (peopleLoading) return peopleLoading;
  peopleLoading = (async () => {
    try {
      const rows = await listPeople();
      state.people = Array.isArray(rows) ? rows : [];
      state.peopleLoaded = true;
      render();
    } catch (e) {
      state.people = state.people || [];
      state.peopleErr = e?.message || '人物卡读取失败';
      render();
    } finally {
      peopleLoading = null;
    }
    /* 本人基本资料单独读一张表，失败不拖垮人物列表 */
    try {
      const sp = await getSelfProfile();
      selfProfileData = sp?.data || {};
      render();
    } catch (e) {
      selfProfileData = selfProfileData || {};
    }
  })();
  return peopleLoading;
}

/* 编辑中的人物草稿；null 表示不显示编辑框 */
let personForm = null;
/* 敏感卡是否已展开（默认全折叠） */
let sensitiveOpen = false;

/* 本人专属的基本信息字段：收集「我是谁」这一层 */
const SELF_FIELDS = [
  { k: 'gender', l: '性别', opts: ['男', '女', '其他'] },
  { k: 'blood', l: '血型', opts: ['A', 'B', 'AB', 'O', '不知道'] },
  { k: 'height', l: '身高 cm', ph: '如 175' },
  { k: 'weight', l: '体重 kg', ph: '如 68' },
  { k: 'job', l: '职业 / 工作', ph: '如 自由职业 / 工程师' },
  { k: 'company', l: '公司 / 单位', ph: '可不填' },
  { k: 'city', l: '所在城市', ph: '如 佛山顺德' },
  { k: 'phone', l: '手机', ph: '自己的手机号' },
  { k: 'wechat', l: '微信号', ph: '微信号 / 其他联系方式' },
  { k: 'motto', l: '口头禅 / 信条', ph: '常挂在嘴边的一句话' }
];

function kindOf(p) {
  if (p.relation === 'self') return SELF_KIND;
  return RELATION_KINDS.find((r) => r.k === p.relation) || RELATION_KINDS[RELATION_KINDS.length - 1];
}

function openPerson(p) {
  const b = p || {};
  const isSelf = b.relation === 'self';
  personForm = {
    id: b.id || null,
    name: b.name || '',
    relation: b.relation || 'friend',
    relation_label: b.relation_label || '',
    closeness: b.closeness ?? 3,
    sensitive: !!b.sensitive,
    not_mention: !!b.not_mention,
    birthday: b.birthday || '',
    likes: b.likes || '',
    dislikes: b.dislikes || '',
    hobbies: b.hobbies || '',
    notes: b.notes || '',
    last_contact: b.last_contact || '',
    /* 本人卡才有基本信息；在表单里切到「本人」也会补上（见 kindRow onclick） */
    extra: isSelf ? { ...(selfProfileData || {}) } : null,
    err: ''
  };
  render();
}

/* ---------- 日期小工具：让人物卡自己会说话 ---------- */

function ageOf(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday + 'T00:00:00');
  if (isNaN(b)) return null;
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  const md = (t.getMonth() + 1) * 100 + t.getDate();
  if (md < (b.getMonth() + 1) * 100 + b.getDate()) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

function daysToBirthday(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday + 'T00:00:00');
  if (isNaN(b)) return null;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  let next = new Date(t.getFullYear(), b.getMonth(), b.getDate());
  if (next < t) next = new Date(t.getFullYear() + 1, b.getMonth(), b.getDate());
  return Math.round((next - t) / 86400000);
}

function relTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年多前`;
}

function knownFor(created_at) {
  if (!created_at) return '';
  const d = new Date(created_at);
  if (isNaN(d)) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 30) return days <= 1 ? '刚记下' : `记了 ${days} 天`;
  if (days < 365) return `记了 ${Math.floor(days / 30)} 个月`;
  const y = Math.floor(days / 365);
  const m = Math.floor((days % 365) / 30);
  return `记了 ${y} 年${m ? ' ' + m + ' 个月' : ''}`;
}

/* ---------------- 人物卡 ---------------- */

function personCard(p, opts = {}) {
  const kind = kindOf(p);
  const isSelf = p.relation === 'self';
  const collapsed = p.sensitive && !sensitiveOpen;

  /* 生日行：年龄 + 距生日天数，一眼看出什么时候要张罗 */
  let birthdayLine = null;
  if (p.birthday) {
    const age = ageOf(p.birthday);
    const dLeft = daysToBirthday(p.birthday);
    birthdayLine = h(
      'div',
      { class: 'pc-line' },
      h('span', { class: 'pc-k' }, '🎂 生日'),
      h(
        'span',
        { class: 'pc-v' },
        p.birthday,
        age != null ? `（${age} 岁）` : '',
        dLeft != null && dLeft <= 30 ? h('span', { class: 'pc-soon' }, dLeft === 0 ? ' · 今天生日！' : ` · ${dLeft} 天后生日`) : null
      )
    );
  }

  const seg = (icon, label, val, cls) =>
    val
      ? h(
          'div',
          { class: 'pc-seg' + (cls ? ' ' + cls : '') },
          h('div', { class: 'pc-seg-h' }, h('span', { class: 'pc-seg-ic' }, icon), label),
          h('div', { class: 'pc-seg-t' }, val)
        )
      : null;

  return h(
    'div',
    {
      class: 'person-card' + (isSelf ? ' is-self' : '') + (p.sensitive ? ' is-sensitive' : ''),
      style: `--pc:${kind.color}`
    },
    h(
      'div',
      { class: 'pc-head' },
      h(
        'div',
        { class: 'pc-avatar', style: `background:${kind.color}` },
        (p.name || '?').slice(0, 1)
      ),
      h(
        'div',
        { class: 'pc-id' },
        h(
          'div',
          { class: 'pc-name' },
          p.name || '（未填名字）',
          p.sensitive ? h('span', { class: 'pc-flag', title: '界面默认折叠' }, '私') : null,
          p.not_mention ? h('span', { class: 'pc-flag pc-flag-ai', title: '问 AI 时不主动提' }, '勿提') : null
        ),
        h(
          'div',
          { class: 'pc-sub' },
          kind.label,
          p.relation_label ? ` · ${p.relation_label}` : '',
          h('span', { class: 'pc-stars', title: `亲密度 ${p.closeness}/5` }, '●'.repeat(p.closeness) + '○'.repeat(5 - p.closeness))
        )
      ),
      h(
        'div',
        { class: 'pc-acts' },
        h('button', { class: 'btn btn-xs btn-ghost', onclick: () => openPerson(p) }, '改'),
        h(
          'button',
          {
            class: 'btn btn-xs btn-ghost',
            onclick: async () => {
              if (!(await ask(`删除「${p.name}」这张卡？`))) return;
              try {
                await deletePerson(p.id);
                state.people = (state.people || []).filter((x) => x.id !== p.id);
                toast('已删除');
                render();
              } catch (e) {
                toast('删除失败：' + (e?.message || '未知错误'), 'err');
              }
            }
          },
          '删'
        )
      )
    ),
    collapsed
      ? h('div', { class: 'pc-collapsed' }, '敏感信息已折叠')
      : h(
          'div',
          { class: 'pc-body' },
          birthdayLine,
          seg('💝', '喜欢', p.likes),
          seg('🚫', '雷区', p.dislikes, 'pc-seg-bad'),
          seg('🎯', '爱好 / 习惯', p.hobbies),
          p.notes ? h('div', { class: 'pc-note' }, p.notes) : null,
          h(
            'div',
            { class: 'pc-foot' },
            h('span', {}, p.last_contact ? `💬 最近联系 ${relTime(p.last_contact)}` : '💬 还没记过联系'),
            h('div', { style: 'flex:1' }),
            knownFor(p.created_at) ? h('span', { class: 'muted' }, knownFor(p.created_at)) : null
          )
        )
  );
}

/* ---------------- 本人卡：基本资料 ----------------

   八字十神盘（四柱、流年、十神关系、用神忌神）已经整体搬到「八字」页。
   这里只保留「我是谁」这一层：性别、生日、职业、城市、联系方式。
   朋友圈放命理盘本来就重——它是自我分析的材料，不是社交名片。 */
function selfCard() {
  const selfRow = (state.people || []).find((x) => x.relation === 'self');
  const sp = selfProfileData || {};
  const infoItems = [
    ['性别', sp.gender],
    ['生日', selfRow?.birthday ? selfRow.birthday : ''],
    ['血型', sp.blood ? sp.blood + ' 型' : ''],
    ['身高体重', sp.height || sp.weight ? `${sp.height || '?'} cm · ${sp.weight || '?'} kg` : ''],
    ['职业', sp.job],
    ['单位', sp.company],
    ['所在城市', sp.city],
    ['手机', sp.phone],
    ['微信', sp.wechat],
    ['口头禅', sp.motto]
  ].filter(([, v]) => v);

  return h(
    'div',
    { class: 'card self-card' },
    h(
      'div',
      { class: 'row-between' },
      h('h3', { class: 'card-title', style: 'margin:0' }, '我'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openPerson(selfRow || { relation: 'self', name: selfRow?.name || '' }) }, '编辑资料')
    ),
    infoItems.length
      ? h('div', { class: 'self-info' }, ...infoItems.map(([k, v]) => h('div', { class: 'self-info-item' }, h('span', { class: 'self-info-k' }, k), h('span', { class: 'self-info-v' }, String(v)))))
      : h('p', { class: 'muted', style: 'margin:10px 0 0;font-size:12px' }, '还没填基本资料，点右上「编辑资料」补上性别、职业、所在城市等。'),
    h(
      'div',
      { class: 'row-between', style: 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line)' },
      h('span', { class: 'muted', style: 'font-size:12px' }, '你的八字十神盘在「八字」页'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setState({ view: 'bazi' }) }, '去看八字')
    )
  );
}

/* ---------------- 编辑面板 ---------------- */

function field(k, label, type = 'text', ph = '') {
  const f = personForm;
  return h(
    'div',
    { style: 'flex:1;min-width:120px' },
    h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, label),
    h('input', {
      class: 'input',
      type,
      placeholder: ph,
      value: f[k] ?? '',
      oninput: (ev) => {
        personForm[k] = ev.target.value;
      }
    })
  );
}

function area(k, label, ph = '') {
  const f = personForm;
  return h(
    'div',
    {},
    h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, label),
    h('textarea', {
      class: 'input',
      rows: '2',
      placeholder: ph,
      style: 'resize:vertical',
      oninput: (ev) => {
        personForm[k] = ev.target.value;
      }
    }, f[k] || '')
  );
}

function personEditor() {
  if (!personForm) return null;
  const f = personForm;
  const isSelf = f.relation === 'self';

  const kindRow = h(
    'div',
    { class: 'chip-row', style: 'gap:6px' },
    [SELF_KIND, ...RELATION_KINDS].map((k) =>
      h(
        'button',
        {
          class: 'chip' + (f.relation === k.k ? ' chip-on' : ''),
          style: f.relation === k.k ? `background:${k.color};border-color:${k.color};color:#fff` : `border-color:${k.color};color:${k.color}`,
          onclick: () => {
            personForm.relation = k.k;
            /* 切到「本人」时补上基本信息表（只在第一次切过来时初始化） */
            if (k.k === 'self' && !personForm.extra) personForm.extra = { ...(selfProfileData || {}) };
            render();
          }
        },
        k.label
      )
    )
  );

  return h(
    'div',
    { class: 'editor', onclick: (ev) => ev.target.classList.contains('editor') && ((personForm = null), render()) },
    h(
      'div',
      { class: 'editor-panel editor-panel-narrow' },
      h(
        'div',
        { class: 'editor-head' },
        h('span', {}, f.id ? '修改人物卡' : '新建人物卡'),
        h('div', { style: 'flex:1' }),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ((personForm = null), render()) }, '关闭')
      ),
      h(
        'div',
        { class: 'editor-body' },
        h('div', { style: 'margin-bottom:12px' }, h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, '关系分类'), kindRow),
        h('div', { class: 'row', style: 'gap:10px' }),
        h('div', { class: 'row', style: 'gap:10px' }, field('name', '名字 / 称呼', 'text', '如 妈妈 / 老王'), field('relation_label', '更细的称呼', 'text', '如 母亲 / 大学室友')),
        h('div', { class: 'gap8' }),
        /* 本人卡专属：收集「我是谁」的基本信息，存 self_profile */
        f.relation === 'self' && f.extra
          ? h(
              'div',
              { style: 'padding:12px;border-radius:10px;background:var(--hover);margin-bottom:12px' },
              h('div', { style: 'font-weight:600;font-size:12.5px;margin-bottom:10px' }, '我的基本信息'),
              h(
                'div',
                { class: 'row', style: 'gap:10px' },
                ...SELF_FIELDS.map((sf) =>
                  sf.opts
                    ? h(
                        'div',
                        { style: 'flex:1;min-width:120px' },
                        h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, sf.l),
                        h(
                          'select',
                          {
                            class: 'input',
                            value: f.extra[sf.k] || '',
                            onchange: (ev) => {
                              personForm.extra[sf.k] = ev.target.value;
                            }
                          },
                          h('option', { value: '' }, '未填'),
                          ...sf.opts.map((o) => h('option', { value: o, selected: f.extra[sf.k] === o }, o))
                        )
                      )
                    : h(
                        'div',
                        { style: 'flex:1;min-width:120px' },
                        h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, sf.l),
                        h('input', {
                          class: 'input',
                          placeholder: sf.ph || '',
                          value: f.extra[sf.k] || '',
                          oninput: (ev) => {
                            personForm.extra[sf.k] = ev.target.value;
                          }
                        })
                      )
                )
              )
            )
          : null,
        h(
          'div',
          { class: 'row', style: 'gap:10px;align-items:flex-end' },
          field('birthday', '生日', 'date'),
          h(
            'div',
            { style: 'flex:1;min-width:120px' },
            h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, `亲密度 ${f.closeness}/5`),
            h('input', {
              type: 'range',
              min: '1',
              max: '5',
              step: '1',
              value: String(f.closeness),
              style: 'width:100%',
              oninput: (ev) => {
                personForm.closeness = Number(ev.target.value);
                ev.target.previousSibling;
                render();
              }
            })
          )
        ),
        h('div', { class: 'gap8' }),
        area('likes', '喜欢什么', '口味、喜欢的礼物、在意的事'),
        h('div', { class: 'gap8' }),
        area('dislikes', '不喜欢什么', '雷区、别碰的话题'),
        h('div', { class: 'gap8' }),
        area('hobbies', '爱好 / 习惯', '运动、游戏、常去的地方'),
        h('div', { class: 'gap8' }),
        area('notes', '备注', '怎么认识的、最近发生的事'),
        h('div', { class: 'gap8' }),
        field('last_contact', '最近联系', 'date'),
        h(
          'div',
          { style: 'margin-top:14px;padding:10px 12px;border-radius:10px;background:var(--hover)' },
          h(
            'label',
            { style: 'display:flex;align-items:flex-start;gap:8px;cursor:pointer;margin-bottom:8px' },
            h('input', {
              type: 'checkbox',
              checked: f.sensitive,
              style: 'margin-top:3px',
              onchange: (ev) => {
                personForm.sensitive = ev.target.checked;
                render();
              }
            }),
            h(
              'span',
              { style: 'font-size:13px;line-height:1.6' },
              '敏感卡：列表里默认折叠，点开才看得到',
              h('div', { class: 'muted', style: 'font-size:12px' }, '适合不想被旁人一眼看到的关系')
            )
          ),
          h(
            'label',
            { style: 'display:flex;align-items:flex-start;gap:8px;cursor:pointer' },
            h('input', {
              type: 'checkbox',
              checked: f.not_mention,
              style: 'margin-top:3px',
              onchange: (ev) => {
                personForm.not_mention = ev.target.checked;
                render();
              }
            }),
            h(
              'span',
              { style: 'font-size:13px;line-height:1.6' },
              '问 AI 时不主动提这个人',
              h('div', { class: 'muted', style: 'font-size:12px' }, '资料仍然保存，只是回答里会回避')
            )
          )
        ),
        h('div', { class: 'err' }, f.err)
      ),
      h(
        'div',
        { class: 'editor-foot' },
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ((personForm = null), render()) }, '取消'),
          h(
            'button',
            {
              class: 'btn btn-sm btn-accent',
              onclick: async () => {
                if (!String(f.name || '').trim()) {
                  personForm.err = '至少填个名字';
                  render();
                  return;
                }
                if (isSelf && (state.people || []).some((x) => x.relation === 'self' && x.id !== f.id)) {
                  personForm.err = '已经有「本人」这张卡了';
                  render();
                  return;
                }
                const rec = {
                  id: f.id,
                  name: String(f.name).trim(),
                  relation: f.relation,
                  relation_label: f.relation_label,
                  closeness: f.closeness,
                  sensitive: f.sensitive,
                  not_mention: f.not_mention,
                  birthday: f.birthday || null,
                  likes: f.likes,
                  dislikes: f.dislikes,
                  hobbies: f.hobbies,
                  notes: f.notes,
                  last_contact: f.last_contact || null
                };
                try {
                  const rows = await savePerson(rec);
                  const row = Array.isArray(rows) && rows[0];
                  if (row) {
                    state.people = f.id
                      ? (state.people || []).map((x) => (x.id === row.id ? row : x))
                      : [...(state.people || []), row];
                  } else {
                    await loadPeople();
                  }
                  /* 本人卡：基本信息另存 self_profile；失败不影响人物卡本体 */
                  if (f.extra) {
                    try {
                      const sp = await saveSelfProfile(f.extra);
                      selfProfileData = sp?.data || f.extra;
                      /* 运势页的大运排向读的是 state.selfProfile，这里同步一下，改了性别立刻生效 */
                      state.selfProfile = Array.isArray(sp) ? sp[0]?.data || f.extra : selfProfileData;
                    } catch (e2) {
                      toast('基本资料没存上：' + (e2?.message || '未知错误'), 'err');
                    }
                  }
                  personForm = null;
                  toast('已保存');
                  render();
                } catch (e) {
                  personForm.err = '保存失败：' + (e?.message || '未知错误');
                  render();
                }
              }
            },
            '保存'
          )
        )
      )
    )
  );
}

/* ---------------- 主视图 ---------------- */

export function peopleView() {
  if (!state.peopleLoaded && !state.peopleLoading) loadPeople();
  const all = state.people || [];

  /* 分组顺序固定：本人 → 亲人 → 朋友 → 同事 → 不喜欢 → 其他 */
  const order = ['self', 'family', 'friend', 'work', 'dislike', 'other'];
  const groups = order
    .map((k) => ({
      k,
      kind: k === 'self' ? SELF_KIND : RELATION_KINDS.find((r) => r.k === k),
      list: all.filter((p) => (p.relation || 'other') === k).sort((a, b) => (b.closeness || 0) - (a.closeness || 0))
    }))
    .filter((g) => g.list.length > 0 && g.k !== 'self');

  const selfRow = all.find((p) => p.relation === 'self');
  const hiddenCount = all.filter((p) => p.sensitive).length;

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', {}, '我的圈子'),
        h('p', { class: 'desc' }, `${all.length} 张人物卡${hiddenCount ? ` · ${hiddenCount} 张已折叠` : ''}`)
      ),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'button',
          {
            class: 'btn btn-ghost',
            onclick: () => import('./view-expert.js').then((m) => m.openExpert('relation'))
          },
          '🧑‍💼 问关系顾问'
        ),
        hiddenCount
          ? h(
              'button',
              {
                class: 'btn btn-ghost',
                onclick: () => {
                  sensitiveOpen = !sensitiveOpen;
                  render();
                }
              },
              sensitiveOpen ? '隐藏敏感卡' : `显示敏感卡（${hiddenCount}）`
            )
          : null,
        h('button', { class: 'btn btn-ghost', onclick: () => openPerson({ relation: 'family' }) }, '+ 亲人'),
        h('button', { class: 'btn btn-accent', onclick: () => openPerson({ relation: 'friend' }) }, '+ 新卡片')
      )
    ),

    selfCard(),

    state.peopleErr
      ? h('div', { class: 'card', style: 'border-color:#c98' }, h('p', { class: 'muted', style: 'margin:0' }, `人物卡没加载出来：${state.peopleErr}`))
      : null,

    all.length === 0 && !selfRow
      ? h(
          'div',
          { class: 'empty' },
          h('div', { class: 'big' }, '◉'),
          h('p', {}, '还没有人物卡。'),
          h('p', { class: 'muted' }, '把常打交道的人记成卡片：喜欢什么、忌讳什么、怎么称呼。'),
          h('button', { class: 'btn btn-accent', style: 'margin-top:14px', onclick: () => openPerson({ relation: 'family' }) }, '建第一张卡')
        )
      : groups.map((g) =>
          h(
            'div',
            { style: 'margin-top:18px' },
            h(
              'div',
              { class: 'group-head' },
              h('span', { class: 'group-dot', style: `background:${g.kind.color}` }),
              h('span', { class: 'group-name' }, g.kind.label),
              h('span', { class: 'muted', style: 'font-size:12px' }, String(g.list.length))
            ),
            h('div', { class: 'person-grid' }, ...g.list.map((p) => personCard(p)))
          )
        ),

    personEditor()
  );
}

/* 供外部（如首页）快速跳转 */
export function openPeopleFor(relation) {
  openPerson({ relation: relation || 'friend' });
}
