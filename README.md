# 使用示例

查看全部命令参数：

```powershell
.\paperflow.cmd --help
```

按研究主题生成 3 篇文章：

```powershell
.\paperflow.ps1 -Topic "multimodal agent tuning" -Count 3
```

指定会议、分类、年份和篇幅：

```powershell
.\paperflow.ps1 `
  -Topic "test-time adaptation" `
  -Count 5 `
  -Venues "ICML,ICLR,NeurIPS" `
  -Tracks "main,workshop" `
  -Years "2025,2026" `
  -Length standard
```

直接处理指定的 arXiv 论文：

```powershell
.\paperflow.ps1 `
  -Urls "https://arxiv.org/abs/2412.15606,https://arxiv.org/abs/2501.00001" `
  -Count 2 `
  -Length standard
```

生成公众号单页长 PDF：

```powershell
.\paperflow.ps1 -Topic "AI for science" -Count 3 -Pdf long
```


如果只想先测试一篇，将 `-Count 5` 改成 `-Count 1`。
