/* 档案文档生成回归：按月分组、三类内容齐全、金额汇总正确、空数据不炸。

   跑法：node test/verify-archive.mjs
*/

import { composeDoc, composeJson, groupByMonth, spendSummary, dayOf, ymOf } from '../src/archive-doc.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + extra : ''));
  }
};

/* ---------- 1. 日期解析 ---------- */
console.log('\n[日期]');
ok("dayOf 取到日期", dayOf('2026-10-08T12:00:00Z') === '2026-10-08', dayOf('2026-10-08T12:00:00Z'));
ok('dayOf 空值返回空串', dayOf(null) === '');
ok('ymOf 取到年月', ymOf('2026-10-08') === '2026-10');
ok('ymOf 脏值不炸', ymOf('abc') === '', ymOf('abc'));

/* ---------- 2. 消费汇总 ---------- */
console.log('\n[消费汇总]');
{
  const list = [
    { direction: 'out', amount: 120, category: '餐饮' },
    { direction: 'out', amount: 380, category: '购物' },
    { direction: 'out', amount: 30, category: '餐饮' },
    { direction: 'in', amount: 8000, category: '工资' }
  ];
  const s = spendSummary(list);
  ok('支出合计 530', s.outSum === 530, s.outSum);
  ok('收入合计 8000', s.inSum === 8000, s.inSum);
  ok('分类按金额排序：购物 380 在前', s.cats[0][0] === '购物' && s.cats[0][1] === 380, JSON.stringify(s.cats));
  ok('同类合并：餐饮 120+30=150', s.cats[1][0] === '餐饮' && s.cats[1][1] === 150, JSON.stringify(s.cats));
  ok('大额（≥200）只挑出购物 380', s.big.length === 1 && s.big[0].amount === 380, s.big.length);
}

/* ---------- 3. 按月分组 ---------- */
console.log('\n[按月分组]');
const data = {
  entries: [
    { entry_date: '2026-10-08', title: '搬进新家', content: '今天把书架装好了，很累但高兴。', mood: '开心', tags: '生活,家', summary: '搬家收尾，书架装好' },
    { entry_date: '2026-09-03', title: '开会', content: '讨论了下季度目标。' }
  ],
  tasks: [
    { kind: 'event', title: '去珀斯', detail: '看房', due_date: '2026-10-12', due_time: '09:30' },
    { kind: 'task', title: '这不是日程', due_date: '2026-10-13' }
  ],
  places: [{ label: '家', city: 'Perth', region: 'WA', created_at: '2026-10-01T03:00:00Z' }],
  tx: [
    { tx_date: '2026-10-02', merchant: '宜家', amount: 1200, direction: 'out', category: '家居' },
    { tx_date: '2026-10-05', merchant: 'Coles', amount: 88, direction: 'out', category: '餐饮' },
    { tx_date: '2026-09-05', merchant: '公司', amount: 9000, direction: 'in', category: '工资' }
  ]
};
{
  const g = groupByMonth(data);
  ok('分成两个月', g.size === 2, g.size);
  ok('10 月有 1 篇经历', g.get('2026-10').entries.length === 1);
  ok('10 月有 1 个行程（普通任务不算）', g.get('2026-10').events.length === 1);
  ok('10 月有 1 个地点', g.get('2026-10').places.length === 1);
  ok('9 月有 1 笔账单', g.get('2026-09').tx.length === 1);
}

/* ---------- 4. 文档内容 ---------- */
console.log('\n[文档内容]');
{
  const doc = composeDoc(data, { now: new Date('2026-10-21T10:00:00+11:00') });
  ok('有标题', doc.startsWith('# 我的生活档案'));
  ok('汇总行正确：2 篇 / 2 条行程 / 3 笔',
    /经历 2 篇.*行程 2 条.*消费 3 笔/.test(doc.replace(/\n/g, ' ')), doc.split('\n')[3]);
  ok('月份倒序：10 月在 9 月前', doc.indexOf('## 2026 年 10 月') < doc.indexOf('## 2026 年 09 月'));
  ok('经历正文在文档里', doc.includes('今天把书架装好了'));
  ok('心情与标签渲染', doc.includes('心情 开心') && doc.includes('#生活'));
  ok('摘要行', doc.includes('> 摘要：'));
  ok('行程带时间', doc.includes('09:30 去珀斯'));
  ok('地点行', doc.includes('到过 家（Perth WA）'));
  ok('10 月消费合计 1288', doc.includes('¥1,288.00'), doc.match(/合计支出 \*\*[^*]+\*\*/)?.[0]);
  ok('大额只列 ≥200 的', doc.includes('宜家') && !doc.includes('Coles ¥88'));
  ok('9 月收入也标出来', doc.includes('收入 ¥9,000.00'));
}

/* ---------- 5. 空数据 ---------- */
console.log('\n[空数据]');
{
  const doc = composeDoc({});
  ok('空数据给占位而不是报错', doc.includes('（还没有任何记录）'));
  const j = composeJson({});
  ok('空 JSON 结构完整', j.kind === 'lifelog-archive' && j.version === 1 && Array.isArray(j.entries));
}

/* ---------- 6. JSON 备份可回读 ---------- */
console.log('\n[结构化备份]');
{
  const j = composeJson(data);
  ok('计数正确', j.counts.entries === 2 && j.counts.transactions === 3, JSON.stringify(j.counts));
  ok('条目按日期规整', j.entries[0].entry_date === '2026-10-08');
  ok('金额是数字', typeof j.transactions[0].amount === 'number');
  ok('方向归一为 in/out', j.transactions.every((t) => t.direction === 'in' || t.direction === 'out'));
  const round = JSON.parse(JSON.stringify(j));
  ok('能序列化再解析', round.entries.length === 2);
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
