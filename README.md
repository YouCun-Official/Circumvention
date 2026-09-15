# 使用示例

## `.env` 必须配置项

首次使用时复制配置模板：

```powershell
Copy-Item .env.example .env
```

使用主题搜索并生成带公网图片的 Markdown/PDF 时，至少填写以下项目。示例只使用占位符，不要把真实密钥提交到 Git：

```dotenv
# OpenAI 兼容模型接口：始终必填
LLM_BASE_URL=<模型服务的 API Base URL>
LLM_API_KEY=<模型服务 API Key>
LLM_MODEL=<模型名称>

# 可选；留空时自动使用 LLM_MODEL
VISION_MODEL=<支持视觉输入的模型名称>

# 使用 -Topic 搜索论文时必填；只使用 -Urls 时可留空
TAVILY_API_KEY=<Tavily API Key>

# 生成可直接粘贴到墨滴的公网图片版时必填
IMAGE_HOST=custom
CUSTOM_UPLOAD_URL=https://www.boltp.com/api/v2/upload
CUSTOM_UPLOAD_TOKEN=<Boltp API Token>
CUSTOM_UPLOAD_STORAGE_ID=2
CUSTOM_UPLOAD_PUBLIC=true
CUSTOM_UPLOAD_REMOVE_EXIF=true
```

`.env` 已被 `.gitignore` 排除。配置完成后可运行 `npm run doctor` 检查模型、Tavily、浏览器和图床配置是否齐全。

查看全部命令参数：

```powershell
.\paperflow.cmd --help
```

按研究主题生成 3 篇文章：

```powershell
.\paperflow.ps1 -Topic "multimodal agent tuning" -Count 3
```

生成“Agent 交互、竞争、合作与博弈”方向的 5 篇文章：

```powershell
.\paperflow.ps1 `
  -Topic "multi-agent interaction, agent competition, agent cooperation, negotiation, game theory, strategic reasoning" `
  -Count 5 `
  -Venues "ICML,ICLR,AAAI,NeurIPS,KDD,ACL,WWW" `
  -Tracks "main,workshop,findings" `
  -Years "2024,2025,2026" `
  -Length standard `
  -Pdf paged `
  -Figures 5
```

`standard` 生成约 2000 个非空白正文字符。每篇结果位于 `outputs/任务编号/论文目录/`：

- `article.local.md`：使用本地 `assets/` 图片，适合离线保存。
- `article.mdnice.md`：使用图床公网 URL，适合粘贴到墨滴或微信公众号编辑器。
- `article.pdf`：A4 竖版分页 PDF。

文章末尾固定保留：

```text
审核 |&#x20;

编辑 |&#x20;
```

## 图床使用流程

在 `.env` 中配置 Boltp 自定义上传器，令牌使用自己的值：

```dotenv
IMAGE_HOST=custom
CUSTOM_UPLOAD_URL=https://www.boltp.com/api/v2/upload
CUSTOM_UPLOAD_TOKEN=<你的图床令牌>
CUSTOM_UPLOAD_STORAGE_ID=2
CUSTOM_UPLOAD_PUBLIC=true
CUSTOM_UPLOAD_REMOVE_EXIF=true
CUSTOM_UPLOAD_DELAY_MS=2000
```

推荐使用闪电图床，需注册邮箱方能使用API进行图片上传。

首次使用前需在 Boltp 账户中完成邮箱验证。运行生成命令后，程序会从论文 PDF 提取图片、依次上传图床，并将返回的 HTTPS 地址写入 `article.mdnice.md`。上传失败会使任务明确失败；对 429 错误会自动等待后重试，重建已有任务时会复用已经上传的公网地址。

直接处理指定的 arXiv 论文：

```powershell
.\paperflow.ps1 `
  -Urls "https://arxiv.org/abs/2412.15606,https://arxiv.org/abs/2501.00001" `
  -Count 2 `
  -Length standard
```
