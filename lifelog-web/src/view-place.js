/* 我在哪里 —— 位置记录
   ------------------------------------------------------------------
   用户要「加一个地址 IP，确定我在哪里」。

   两条信息通道，性质完全不同，界面上必须分开写清楚：

     1. 浏览器定位（geolocation）
        精度：城市级（故意不开 enableHighAccuracy）
        需要用户点一下授权；只在你按按钮那一刻取一次，不记录轨迹。
        失败原因很多（浏览器不支持 / 拒授权 / 室内无 GPS / HTTPS 限制），
        每种都给一句人能看懂的话，不甩 "unknown error"。

     2. IP 归属地
        精度：城市级，且经常是运营商出口机房所在地（可能差几百公里）。
        不需要授权，但也不该被当成「你在这儿」。

   隐私口径：本地只保留最近 20 条，云端 places 表也是用户主动写才写。
   不做后台定时定位。
*/

import { h, render, toast, state, ask } from './store.js';
import { listPlaces, savePlace, deletePlace } from './cloud.js';

let placesLoading = null;

export async function loadPlaces() {
  if (placesLoading) return placesLoading;
  placesLoading = (async () => {
    try {
      const rows = await listPlaces();
      state.places = Array.isArray(rows) ? rows : [];
      state.placesLoaded = true;
      render();
    } catch (e) {
      state.places = state.places || [];
      state.placesErr = e?.message || '位置读取失败';
      render();
    } finally {
      placesLoading = null;
    }
  })();
  return placesLoading;
}

/* 定位状态机：idle → asking → ok / fail */
let geo = { status: 'idle', msg: '', accuracy: null, lat: null, lon: null, at: null };
/* IP 归属地查询结果 */
let ipInfo = { status: 'idle', msg: '', data: null };
/* 用户给这次定位起的名字（家 / 公司 / 出差地） */
let labelDraft = '当前位置';
let saving = false;

/** 浏览器定位失败原因翻译成人话 */
function geoErrText(err) {
  const code = err && err.code;
  if (err && err.message && !code) return err.message;
  switch (code) {
    case 1:
      return '你拒绝了定位授权。想重新授权：点地址栏左侧的小锁 / 图标 → 位置 → 允许，然后刷新页面。';
    case 2:
      return '设备拿不到位置信号。室内、地下、没开系统定位服务时常见，换个地方或开一下系统定位再试。';
    case 3:
      return '定位超时了。网络慢或 GPS 冷启动时会这样，再点一次通常就好。';
    default:
      return '定位失败，原因不明。可以手动填一个城市。';
  }
}

function doGeolocate() {
  if (!navigator.geolocation) {
    geo = { ...geo, status: 'fail', msg: '这个浏览器不支持定位。可以手动填城市。' };
    render();
    return;
  }
  /* 非 HTTPS 下多数浏览器直接禁掉 geolocation */
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    geo = { ...geo, status: 'fail', msg: '当前不是 HTTPS，浏览器不允许定位。请用 https 打开，或手动填城市。' };
    render();
    return;
  }
  geo = { ...geo, status: 'asking', msg: '正在请求定位…' };
  render();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const c = pos.coords;
      geo = {
        status: 'ok',
        msg: '',
        accuracy: Math.round(c.accuracy || 0),
        lat: +c.latitude.toFixed(5),
        lon: +c.longitude.toFixed(5),
        at: new Date()
      };
      /* 精度很差时提醒一句，避免用户以为精确到门牌 */
      if ((c.accuracy || 0) > 20000) geo.msg = `精度约 ${Math.round((c.accuracy || 0) / 1000)} 公里，只能算「大概在这片区域」。`;
      labelDraft = '当前位置';
      render();
      /* 顺手做一次 IP 查询，两条信息互相印证 */
      doIpLookup();
    },
    (err) => {
      geo = { ...geo, status: 'fail', msg: geoErrText(err) };
      render();
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
  );
}

/** IP 归属地：多源兜底，任一成功即用 */
async function doIpLookup() {
  ipInfo = { status: 'loading', msg: '正在查 IP 归属地…', data: null };
  render();
  const sources = [
    {
      url: 'https://ipapi.co/json/',
      pick: (j) => ({ city: j.city, region: j.region, country: j.country_name, ip: j.ip, org: j.org })
    },
    {
      url: 'https://ipwho.is/',
      pick: (j) => ({ city: j.city, region: j.region, country: j.country, ip: j.ip, org: j.connection?.isp })
    }
  ];
  for (const s of sources) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(s.url, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const j = await res.json();
      if (j && j.error) continue;
      if (j && j.success === false) continue;
      const d = s.pick(j);
      if (!d.city && !d.country) continue;
      ipInfo = { status: 'ok', msg: '', data: d };
      render();
      return;
    } catch (e) {
      /* 换下一个源 */
    }
  }
  ipInfo = {
    status: 'fail',
    msg: '查不到 IP 归属地（可能被网络环境拦了，或这个源暂时不可用）。不影响手动填城市。',
    data: null
  };
  render();
}

async function saveCurrent() {
  if (geo.status !== 'ok' || saving) return;
  saving = true;
  render();
  const rec = {
    label: labelDraft || '当前位置',
    city: ipInfo.data?.city || '',
    region: ipInfo.data?.region || '',
    country: ipInfo.data?.country || '',
    lat: geo.lat,
    lon: geo.lon,
    accuracy: geo.accuracy,
    is_home: /家|住/.test(labelDraft),
    is_work: /公司|上班|办公/.test(labelDraft),
    note: ipInfo.data ? `IP ${ipInfo.data.ip || ''} ${ipInfo.data.org || ''}`.trim() : ''
  };
  try {
    const rows = await savePlace(rec);
    const row = Array.isArray(rows) && rows[0];
    state.places = row ? [row, ...(state.places || [])] : state.places;
    toast('位置已记录');
    await loadPlaces();
  } catch (e) {
    toast('保存失败：' + (e?.message || '未知错误'), 'err');
  } finally {
    saving = false;
    render();
  }
}

function statusBox() {
  if (geo.status === 'idle') {
    return h(
      'div',
      { class: 'loc-status' },
      h('div', { class: 'loc-big' }, '📍'),
      h('p', { style: 'margin:0 0 4px' }, '还没定位'),
      h('p', { class: 'muted', style: 'margin:0;font-size:12.5px' }, '点下面的按钮，浏览器会问你一次要不要允许。只取这一次，不记录轨迹。')
    );
  }
  if (geo.status === 'asking') {
    return h('div', { class: 'loc-status' }, h('div', { class: 'spinner' }), h('p', { style: 'margin:8px 0 0' }, geo.msg));
  }
  if (geo.status === 'fail') {
    return h(
      'div',
      { class: 'loc-status is-bad' },
      h('div', { class: 'loc-big' }, '⚠'),
      h('p', { style: 'margin:0;font-size:13.5px;line-height:1.7' }, geo.msg)
    );
  }
  /* ok */
  return h(
    'div',
    { class: 'loc-status is-ok' },
    h('div', { class: 'loc-big' }, '✓'),
    h('p', { style: 'margin:0 0 6px;font-weight:600' }, ipInfo.data?.city ? `大概在 ${ipInfo.data.city}` : '已拿到坐标'),
    h(
      'p',
      { class: 'muted', style: 'margin:0;font-size:12.5px;line-height:1.8' },
      `坐标 ${geo.lat}, ${geo.lon}　精度约 ${geo.accuracy} 米`
    ),
    geo.msg ? h('p', { class: 'muted', style: 'margin:6px 0 0;font-size:12.5px' }, geo.msg) : null
  );
}

export function placeView() {
  if (!state.placesLoaded && !state.placesLoading) loadPlaces();
  const list = state.places || [];

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', {}, '我在哪里'),
        h('p', { class: 'desc' }, '定位与 IP 归属地 · 只在你点按钮时取，不做后台轨迹')
      ),
      h(
        'div',
        { class: 'toolbar' },
        h('button', { class: 'btn btn-accent', onclick: doGeolocate, disabled: geo.status === 'asking' }, geo.status === 'asking' ? '定位中…' : '📍 获取当前位置'),
        h('button', { class: 'btn btn-ghost', onclick: doIpLookup, disabled: ipInfo.status === 'loading' }, ipInfo.status === 'loading' ? '查询中…' : '查 IP 归属地')
      )
    ),

    h(
      'div',
      { class: 'loc-grid' },
      /* 左：浏览器定位 */
      h(
        'div',
        { class: 'card' },
        h('h3', { class: 'card-title' }, '浏览器定位'),
        statusBox(),
        geo.status === 'ok'
          ? h(
              'div',
              { style: 'margin-top:14px' },
              h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, '给这个位置起个名字'),
              h(
                'div',
                { class: 'row', style: 'gap:8px' },
                h('input', {
                  class: 'input',
                  style: 'flex:1',
                  value: labelDraft,
                  placeholder: '家 / 公司 / 常去的咖啡馆',
                  oninput: (ev) => {
                    labelDraft = ev.target.value;
                  }
                }),
                h('button', { class: 'btn btn-sm btn-accent', onclick: saveCurrent, disabled: saving }, saving ? '保存中…' : '记下来')
              )
            )
          : null,
        h(
          'p',
          { class: 'hint', style: 'margin-top:14px' },
          '精度：城市级。故意不开高精度模式——室内高精度容易超时，而且日常也只需要知道「在哪座城市」。'
        )
      ),

      /* 右：IP */
      h(
        'div',
        { class: 'card' },
        h('h3', { class: 'card-title' }, 'IP 归属地'),
        ipInfo.status === 'idle'
          ? h('p', { class: 'muted', style: 'margin:0' }, '还没查。IP 归属地能给出运营商所在地，但可能跟你的实际位置差几百公里。')
          : ipInfo.status === 'loading'
            ? h('div', { class: 'loc-status' }, h('div', { class: 'spinner' }), h('p', { style: 'margin:8px 0 0' }, ipInfo.msg))
            : ipInfo.status === 'fail'
              ? h('p', { class: 'muted', style: 'margin:0;line-height:1.75' }, ipInfo.msg)
              : h(
                  'div',
                  {},
                  h(
                    'div',
                    { class: 'pc-line' },
                    h('span', { class: 'pc-k' }, '城市'),
                    h('span', { class: 'pc-v' }, ipInfo.data.city || '—')
                  ),
                  h(
                    'div',
                    { class: 'pc-line' },
                    h('span', { class: 'pc-k' }, '地区'),
                    h('span', { class: 'pc-v' }, ipInfo.data.region || '—')
                  ),
                  h(
                    'div',
                    { class: 'pc-line' },
                    h('span', { class: 'pc-k' }, '国家'),
                    h('span', { class: 'pc-v' }, ipInfo.data.country || '—')
                  ),
                  h(
                    'div',
                    { class: 'pc-line' },
                    h('span', { class: 'pc-k' }, 'IP'),
                    h('span', { class: 'pc-v', style: 'font-family:ui-monospace,monospace' }, ipInfo.data.ip || '—')
                  ),
                  ipInfo.data.org
                    ? h(
                        'div',
                        { class: 'pc-line' },
                        h('span', { class: 'pc-k' }, '运营商'),
                        h('span', { class: 'pc-v' }, ipInfo.data.org)
                      )
                    : null
                ),
        h(
          'p',
          { class: 'hint', style: 'margin-top:14px' },
          'IP 归属地由第三方接口查询：ipapi.co、ipwho.is。两个都查不到就不显示，不会猜一个给你。'
        )
      )
    ),

    /* 历史 */
    h(
      'div',
      { class: 'card', style: 'margin-top:16px' },
      h(
        'div',
        { class: 'row-between' },
        h('h3', { class: 'card-title', style: 'margin:0' }, '记录过的地方'),
        h('span', { class: 'muted', style: 'font-size:12px' }, `最近 ${list.length} 条`)
      ),
      list.length === 0
        ? h('p', { class: 'muted', style: 'margin:12px 0 0' }, '还没有记录。定位成功后点「记下来」就会出现在这里。')
        : h(
            'div',
            { style: 'margin-top:10px' },
            list.map((pl) =>
              h(
                'div',
                { class: 'loc-row' },
                h(
                  'div',
                  { style: 'flex:1;min-width:0' },
                  h(
                    'div',
                    { style: 'font-weight:600;font-size:13.5px' },
                    pl.label || '位置',
                    pl.is_home ? h('span', { class: 'pc-flag' }, '家') : null,
                    pl.is_work ? h('span', { class: 'pc-flag' }, '公司') : null
                  ),
                  h(
                    'div',
                    { class: 'muted', style: 'font-size:12px;line-height:1.6' },
                    [pl.city, pl.region, pl.country].filter(Boolean).join(' · ') || '—',
                    pl.lat != null ? `　${Number(pl.lat).toFixed(4)}, ${Number(pl.lon).toFixed(4)}` : ''
                  )
                ),
                h(
                  'button',
                  {
                    class: 'btn btn-xs btn-ghost',
                    onclick: async () => {
                      if (!(await ask('删除这条位置记录？'))) return;
                      try {
                        await deletePlace(pl.id);
                        state.places = (state.places || []).filter((x) => x.id !== pl.id);
                        render();
                      } catch (e) {
                        toast('删除失败：' + (e?.message || '未知错误'), 'err');
                      }
                    }
                  },
                  '删'
                )
              )
            )
          )
    ),

    h(
      'p',
      { class: 'hint', style: 'margin-top:12px' },
      '隐私：定位只在点击时发生，页面关掉就停；不会定时上报，也不记录移动轨迹。'
    )
  );
}
