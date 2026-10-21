/* 「给 Claude 研究」导出校验：覆盖全部板块、决策标签单列、隐私字段不外泄。
   运行：node test/verify-research.mjs */
import { toResearchMarkdown, hasDecisionTag } from '../src/research-export.js';

let fail = 0;
const ok = (cond, msg) => {
  if (!cond) fail += 1;
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};

const bundle = {
  account: { email: 'secret@example.com', phone: '13800000000', userId: 'uid-xyz' },
  data: {
    entries: [
      { id: 1, entry_date: '2026-10-01', title: '买不买峻峦', content: '选项：买/不买。首付 200 万。直觉想买。', tags: '决策 香港', mood: 'calm' },
      { id: 2, entry_date: '2026-10-05', title: '', content: '今天陪家人吃饭，很开心', tags: '', facets: ['family', 'joy'] }
    ],
    todos: [{ id: 9, entry_id: 2, title: '给妈妈打电话', status: 'todo', source_date: '2026-10-05' }],
    transactions: [
      { tx_date: '2026-10-02', amount: 100, direction: 'out', category: '餐饮', merchant: '茶餐厅' },
      { tx_date: '2026-10-03', amount: 5000, direction: 'in', category: '工资', merchant: '公司' },
      { tx_date: '2025-01-03', amount: 300, direction: 'out', category: '交通', merchant: '出租车' }
    ],
    goals: [{ title: '年底净资产+10%', category: 'money', progress: 40, status: 'active' }],
    tasks: [{ title: '约律师看合同', status: 'todo', due_date: '2026-10-30' }],
    accounts: [
      { name: '储蓄', kind: 'bank', balance: 10000 },
      { name: '房贷', kind: 'loan', balance: 3000, is_liability: true }
    ],
    budgets: [{ category: '餐饮', month: '', amount: 2000 }],
    signals: [{ title: '顺德地块政策', area: 'money', status: 'new', ai_score: 2, ai_take: '可关注' }],
    health_logs: [{ log_date: '2026-10-04', sleep_hours: 7, mood: 4, energy: 3, note: 'ok' }],
    people: [
      { name: '阿明', relation: 'friend', closeness: 4, likes: '钓鱼' },
      { name: '某人', relation: 'other', closeness: 2, sensitive: true, notes: '不该导出的私事' }
    ],
    birth_info: [{ year: 1980, month: 5, day: 6, hour: 8, minute: 0, cal: 'solar', place: '顺德', lat: 22.8 }],
    bazi_qa: [{ day_key: '2026-10-01', question: '本月适合买房吗', answer: '……' }],
    places: [{ label: '家', city: 'Sydney', country: 'Australia', lat: -33.86, lon: 151.2, is_home: true }],
    looks: [{ kind: 'outfit', title: '见银行经理', taken_at: '2026-10-02T09:00:00Z', url: 'https://img/1.jpg' }]
  }
};

const md = toResearchMarkdown(bundle, { today: '2026-10-22' });

ok(hasDecisionTag({ tags: '决策 香港' }) && !hasDecisionTag({ tags: '决策者' }), '决策标签识别（整词匹配）');
ok(/决策记录（日记标签「决策」，1 条）[\s\S]*买不买峻峦/.test(md), '决策记录单独成节');
for (const s of ['## 目标', '## 未完成的任务和待办', '## 财务', '## 收集的外部机会', '## 身体与精力', '## 身边的人', '## 八字', '## 穿搭记录', '## 常在地点', '## 日记全文'])
  ok(md.includes(s), `包含「${s.replace('## ', '')}」`);
ok(md.includes('| 2026-10 | ¥5,000 | ¥100 | ¥4,900 |'), '按月汇总正确');
ok(md.includes('净资产 ¥7,000'), '净资产计算正确');
ok(md.includes('茶餐厅') && !md.includes('出租车'), '明细只列最近 3 个月');
ok(md.includes('交通'), '分类排名覆盖全部时间');
ok(md.includes('给妈妈打电话'), '日记附带待办');
ok(!md.includes('secret@example.com') && !md.includes('13800000000') && !md.includes('uid-xyz'), '不含邮箱/手机/账号ID');
ok(!md.includes('-33.86') && !md.includes('151.2') && !md.includes('22.8'), '不含经纬度');
ok(!md.includes('不该导出的私事') && md.includes('某人'), '敏感人物只留名字');
ok(!md.includes('img/1.jpg'), '不含照片链接');

const empty = toResearchMarkdown({ data: {} }, { today: '2026-10-22' });
ok(empty.includes('（还没有。') && empty.includes('（暂无账单）'), '空数据不报错');

console.log(fail ? `✗ ${fail} 项失败` : '✓ 研究导出全部通过');
process.exit(fail ? 1 : 0);
