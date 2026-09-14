import path from 'node:path';
import { createJob } from './job-store.js';
import { runJob } from './pipeline.js';

const HELP = `
PaperFlow Publisher - 顶会论文分享批量生成器

用法：
  npm run generate -- --topic "多模态智能体" --count 3
  npm run generate -- --urls "2412.15606,https://arxiv.org/abs/2501.00001"

参数：
  --topic <主题>       检索方向；使用英文通常更准确
  --urls <链接/ID>     指定 arXiv 链接或 ID，多个用逗号分隔
  --count <1-20>       生成篇数，默认 3
  --venues <列表>      ICML,ICLR,AAAI,NEURIPS,KDD,ACL,WWW；默认全部
  --tracks <列表>      main,workshop,findings；默认全部
  --years <列表>       会议年份，如 2025,2026；默认当年和上一年
  --length <档位>      compact(2100-2900)、standard(3000-4400)、detailed(4700-6200)
  --pdf <版式>         paged 或 long，默认 paged
  --figures <0-10>     每篇最大配图数，默认 5
  --editor <姓名>      编辑署名
  --reviewer <姓名>    审核署名
  --help               显示帮助

程序按所选会议、年份和分类构造 Tavily 查询，批量汇总并去重 arXiv 结果。
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const equal = token.indexOf('=');
    if (equal > 2) out[token.slice(2, equal)] = token.slice(equal + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[token.slice(2)] = argv[++i];
    else out[token.slice(2)] = true;
  }
  return out;
}

let input;
try { input = parseArgs(process.argv.slice(2)); }
catch (error) { console.error(error.message); console.log(HELP); process.exit(2); }

if (input.help) {
  console.log(HELP);
  process.exit(0);
}

const job = createJob({
  topic: input.topic || '',
  paperUrls: input.urls || '',
  count: Number(input.count || 3),
  venues: input.venues || 'all',
  tracks: input.tracks || 'all',
  years: input.years || '',
  length: input.length || 'standard',
  pdfMode: input.pdf || 'paged',
  maxFigures: Number(input.figures ?? 5),
  editor: input.editor || '',
  reviewer: input.reviewer || ''
});

console.log(`任务：${job.id}`);
console.log(`输出目录：${path.resolve('outputs', job.id)}`);

try {
  const result = await runJob(job.id, {
    onEvent(event) {
      const time = new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false });
      const prefix = event.level === 'error' ? '错误' : event.level === 'warn' ? '提示' : '进度';
      console.log(`[${time}] ${prefix} ${event.message}`);
    }
  });
  console.log('');
  console.log(`状态：${result.status}`);
  for (const paper of result.papers || []) {
    console.log(`- ${paper.status === 'completed' ? '完成' : '失败'} ${paper.title}`);
    if (paper.files) console.log(`  Markdown：${path.resolve('outputs', paper.files.localMarkdown)}`);
    if (paper.error) console.log(`  原因：${paper.error}`);
  }
  if (result.status === 'failed') process.exitCode = 1;
} catch (error) {
  console.error(`\n任务失败：${error.message}`);
  process.exitCode = 1;
}
