/* 测试用：模拟 claude.ai 运行时（db / user / sample / downloads），
   让 Playwright 能在本地把「云端同步」那条路径完整跑一遍。
   数据存在 window.__mockStore（可选持久化到 localStorage 'mockdb'）。 */
(function () {
  const KEY = '__mockdb';
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch (e) {}
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch (e) {}
  };
  window.__mockStore = store;
  window.__mockCalls = { set: 0, del: 0, get: 0, sample: 0, save: [] };

  const segs = (p) => p.split('/');
  function docRef(path) {
    if (segs(path).length % 2) throw new TypeError('doc path must be even: ' + path);
    return {
      id: segs(path).slice(-1)[0],
      path,
      async get() {
        window.__mockCalls.get++;
        const d = store[path];
        return { id: this.id, exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined), metadata: {} };
      },
      async set(data) {
        window.__mockCalls.set++;
        if (JSON.stringify(data).length > 256 * 1024) throw { code: 'invalid_argument', message: 'too big' };
        store[path] = JSON.parse(JSON.stringify(data));
        persist();
      },
      async update(data) {
        if (!store[path]) throw { code: 'invalid_argument', message: 'missing' };
        Object.assign(store[path], data);
        persist();
      },
      async delete() {
        window.__mockCalls.del++;
        delete store[path];
        persist();
      },
      collection: (sub) => collRef(path + '/' + sub)
    };
  }
  function query(path, filters, order, lim) {
    return {
      where: (f, op, v) => query(path, [...filters, [f, op, v]], order, lim),
      orderBy: (f, dir) => query(path, filters, [f, dir || 'asc'], lim),
      limit: (n) => {
        if (n < 1 || n > 1000) throw { code: 'invalid_argument' };
        return query(path, filters, order, n);
      },
      async get() {
        window.__mockCalls.get++;
        const pre = path + '/';
        let docs = Object.keys(store)
          .filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/'))
          .map((k) => ({ id: k.slice(pre.length), body: store[k] }));
        for (const [f, op, v] of filters) {
          docs = docs.filter((d) => {
            const x = d.body[f];
            if (op === '>') return x > v;
            if (op === '==') return x === v;
            return true;
          });
        }
        if (order) docs.sort((a, b) => (a.body[order[0]] > b.body[order[0]] ? 1 : -1) * (order[1] === 'desc' ? -1 : 1));
        if (lim) docs = docs.slice(0, lim);
        const out = docs.map((d) => ({ id: d.id, exists: true, data: () => JSON.parse(JSON.stringify(d.body)), metadata: {} }));
        return { docs: out, size: out.length, empty: !out.length, metadata: {}, docChanges: () => [] };
      }
    };
  }
  function collRef(path) {
    if (segs(path).length % 2 === 0) throw new TypeError('collection path must be odd: ' + path);
    return Object.assign(query(path, [], null, null), {
      path,
      doc: (id) => docRef(path + '/' + (id || Math.random().toString(36).slice(2)))
    });
  }
  const db = { doc: docRef, collection: collRef };

  const user = {
    id: async () => 'user_test123',
    me: async () => ({ id: 'user_test123', name: '测试用户', email: null }),
    isOwner: () => true,
    canEdit: () => true,
    can: () => true
  };

  async function sample(input, opts = {}) {
    window.__mockCalls.sample++;
    window.__lastSample = input;
    const last = Array.isArray(input) ? input[input.length - 1].content : input;
    let text;
    if (/JSON 数组/.test(last) && /归类/.test(last)) text = '[{"i":1,"c":"餐饮"}]';
    else if (/"verdict"/.test(last)) text = '{"score":2,"area":"money","verdict":"对你的投资目标很有利","why":"和你在推进的目标直接相关","actions":["本周联系中介了解","算一下现金流"],"deadline":"年底前"}';
    else if (/结构化摘要|"summary"/.test(JSON.stringify(input)))
      text = '{"summary":"今天去了公司，晚上吃了兰州拉面。","points":["上班","吃拉面"],"topics":["工作","饮食"],"mood":"calm","todos":["明天交报告"],"people":["小王"],"money":"拉面 18 元","title":"平常的一天","facets":["joy","family"]}';
    else text = '这是模拟的 Claude 回答：' + String(last).slice(0, 30);
    await new Promise((r) => setTimeout(r, 50));
    const half = Math.floor(text.length / 2);
    opts.onText && opts.onText({ text: text.slice(0, half), delta: text.slice(0, half) });
    await new Promise((r) => setTimeout(r, 30));
    opts.onText && opts.onText({ text, delta: text.slice(half) });
    return { text, truncated: false, modelTierApplied: opts.modelTier || 'default' };
  }
  sample.json = async (i, o) => JSON.parse((await sample(i, o)).text);
  sample.limits = async () => ({ maxPromptBytes: 262144 });

  const downloads = {
    save: async ({ filename, data }) => {
      const text = typeof data === 'string' ? data : await data.text();
      window.__mockCalls.save.push({ filename, size: text.length, text });
      return { status: 'saved' };
    }
  };

  /* Gmail：记录发出的邮件；window.__mailFail = 'needs_reauth' 可模拟失败 */
  window.__mockCalls.mail = [];
  const mcp = {
    callTool: async (server, tool, input) => {
      await new Promise((r) => setTimeout(r, 60));
      if (window.__mailFail) throw { code: window.__mailFail, message: 'mock fail' };
      if (server !== 'Gmail' || tool !== 'send_message') throw { code: 'not_in_manifest', message: server + '/' + tool };
      window.__mockCalls.mail.push(JSON.parse(JSON.stringify(input)));
      return { payload: { id: 'm' + Date.now(), threadId: 't1', labelIds: ['SENT'] } };
    }
  };

  const caps = { db, user, sample, downloads, mcp };
  window.claude = {
    use: (name) => new Promise((r) => setTimeout(() => r(caps[name] || null), 80))
  };
})();
