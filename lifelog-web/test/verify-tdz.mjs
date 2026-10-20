/* 检查「暂时性死区」类错误。

   顶层用 let/const 声明的变量，如果在声明语句之前就被某个函数体引用，
   而那个函数恰好又先被调用，运行时就会抛 ReferenceError。
   表现是整个页面卡在「正在启动」白屏，连登录页都出不来 ——
   构建工具完全不报这个错，只有真机打开才发现，代价太大。

   判定规则（尽量不误报）：
   1. 只查文件顶层的 let/const/var；
   2. 只在声明之前的代码里找同名标识符；
   3. 该位置必须处于「顶层直接执行的代码」中 —— 顶层 if/try/for 里的语句
      会在模块加载时立刻执行，是真正的风险；函数体内的引用取决于何时调用，
      单独归为「待确认」一栏，不算失败；
   4. 跳过注释、字符串、成员访问（a.name）、对象键（name: 1）、形参。

   用法：node verify-tdz.mjs
   退出码：0 = 无立即风险；1 = 有会在加载时炸的引用。 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;
const files = readdirSync(SRC).filter((f) => f.endsWith('.js'));

const BLOCK_COMMENT = new RegExp('/' + '\\*' + '[\\s\\S]*?' + '\\*' + '/', 'g');

/* 把注释替换成等长空白（保留换行），行号不变 */
function stripComments(src) {
  return src
    .replace(BLOCK_COMMENT, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/* 逐行计算「进入该行时的花括号深度」以及「该行是否在函数体内」 */
function analyze(lines) {
  const depthAt = [];
  const inFunc = [];
  let dep = 0;
  let fnDep = -1; /* 进入函数体时的深度，-1 表示不在函数内 */
  for (const raw of lines) {
    depthAt.push(dep);
    inFunc.push(fnDep >= 0);
    const noStr = raw.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
    for (const ch of noStr) {
      if (ch === '{') {
        dep += 1;
        /* `=> {` 或 `function ... {` 视作进入函数体 */
        if (fnDep < 0 && /(=>\s*\{|\bfunction\b[^{]*\{|\bconstructor\s*\([^)]*\)\s*\{)$/.test(noStr.slice(0, noStr.indexOf(ch) + 1))) {
          fnDep = dep;
        }
      }
      if (ch === '}') {
        if (fnDep === dep) fnDep = -1;
        dep -= 1;
      }
    }
  }
  return { depthAt, inFunc };
}

let hard = 0;
let soft = 0;
let checked = 0;
const softList = [];

for (const file of files) {
  const raw = readFileSync(join(SRC, file), 'utf8');
  const lines = raw.split('\n');
  const code = stripComments(raw).split('\n');
  const { depthAt, inFunc } = analyze(code);

  /* 顶层声明：该行进入时深度为 0，且不在函数体内 */
  const decls = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (depthAt[i] !== 0 || inFunc[i]) continue;
    const m = code[i].trim().match(/^(?:export\s+)?(?:let|const|var)\s+([A-Za-z_$][\w$]*)/);
    if (m) decls.push({ name: m[1], line: i });
  }

  for (const d of decls) {
    checked += 1;
    const name = d.name.replace(/\$/g, '\\$');
    /* 前面不能是标识符字符、$、.、引号；后面不能是标识符字符或冒号（对象键） */
    const re = new RegExp(`(^|[^\\w$.'"\`])${name}(?![\\w$])`, 'g');

    for (let i = 0; i < d.line; i += 1) {
      const line = code[i];
      if (/^\s*import\b/.test(line)) continue; /* import 语句里的名字不是引用 */
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        /* 对象字面量的键 / 形参 / 局部声明：跳过 */
        const after = line.slice(m.index + m[0].length).trimStart();
        if (after.startsWith(':')) continue;
        if (new RegExp(`(?:function|const|let|var)\\s+${name}\\b`).test(line)) continue;

        if (inFunc[i]) {
          soft += 1;
          softList.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}  （${d.name} 声明于 ${d.line + 1} 行）`);
        } else {
          hard += 1;
          console.log(`❌ ${file}:${i + 1} 在顶层直接引用了 ${d.name}，但它第 ${d.line + 1} 行才声明`);
          console.log(`   ${line.trim().slice(0, 110)}`);
        }
        break;
      }
    }
  }
}

console.log('');
if (softList.length) {
  console.log('ℹ️ 以下引用位于函数体内，只有「在声明前被调用」才出事（已人工确认过，仅供参考）：');
  for (const s of softList.slice(0, 12)) console.log('   ' + s);
  if (softList.length > 12) console.log(`   …另有 ${softList.length - 12} 处`);
  console.log('');
}

if (hard) {
  console.log(`结果：${checked} 个顶层声明中发现 ${hard} 处会在加载时立即报错`);
  process.exit(1);
}
console.log(`结果：${checked} 个顶层声明，没有「加载时立即报错」的先用后声明`);
