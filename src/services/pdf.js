import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { visionJson } from './llm.js';

globalThis.DOMMatrix ||= DOMMatrix;
globalThis.ImageData ||= ImageData;
globalThis.Path2D ||= Path2D;

let pdfjsPromise;
async function pdfjs() {
  pdfjsPromise ||= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function openPdf(file) {
  const lib = await pdfjs();
  const data = new Uint8Array(fs.readFileSync(file));
  return lib.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
}

function linesFromItems(items, pageHeight) {
  const rows = [];
  for (const item of items) {
    const text = String(item.str || '').trim();
    if (!text) continue;
    const y = pageHeight - Number(item.transform?.[5] || 0);
    const x = Number(item.transform?.[4] || 0);
    let row = rows.find(candidate => Math.abs(candidate.y - y) < 3.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text });
  }
  return rows
    .sort((a, b) => a.y - b.y)
    .map(row => ({ y: row.y, text: row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ').replace(/\s+/g, ' ') }));
}

export function captionRows(lines) {
  const regex = /^\s*(?:Figure|Fig\.?|Table)\s*[A-Z]?\d+(?:[.:]|\s)/i;
  const reference = /^\s*(?:Figure|Fig\.?|Table)\s*[A-Z]?\d+\s+(?:is|are|was|were|shows?|lists?|presents?|illustrates?|reports?|summari[sz]es?|compares?|provides?|contains?|demonstrates?|has|have|includes?)\b/i;
  return lines.filter(line => regex.test(line.text) && !reference.test(line.text));
}

export async function extractPdfText(file) {
  const doc = await openPdf(file);
  const pages = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const lines = linesFromItems(content.items, viewport.height);
    pages.push({ page: pageNo, width: viewport.width, height: viewport.height, lines, text: lines.map(x => x.text).join('\n'), captions: captionRows(lines) });
  }
  return { numPages: doc.numPages, pages, text: pages.map(x => `\n--- PAGE ${x.page} ---\n${x.text}`).join('\n') };
}

async function renderPage(file, pageNo, scale = 2.2) {
  const doc = await openPdf(file);
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  return { buffer: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height, scale };
}

function cleanCaption(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function fallbackBoxes(page) {
  return page.captions.map((caption, index) => {
    const previous = index ? page.captions[index - 1].y : 20;
    let top = Math.max(24, previous + 30);
    if (caption.y - top > page.height * 0.56) top = Math.max(24, caption.y - page.height * 0.48);
    // The generated article adds its own readable Chinese caption. Excluding the
    // PDF caption here avoids pulling the following paragraph into the crop.
    if (page.page === 1 && index === 0) top = Math.max(top, caption.y - page.height * 0.44);
    const bottom = Math.min(page.height - 20, caption.y - 16);
    return {
      captionIndex: index,
      bbox: [0.055, top / page.height, 0.89, Math.max(0.08, (bottom - top) / page.height)],
      method: 'fallback'
    };
  });
}

function validBox(box) {
  return Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) &&
    box[0] >= 0 && box[1] >= 0 && box[2] > 0.08 && box[3] > 0.06 &&
    box[0] + box[2] <= 1.02 && box[1] + box[3] <= 1.02;
}

async function locateWithVision(cfg, page, image) {
  if (!cfg.visionModel && !cfg.llmModel) return [];
  const captions = page.captions.map((x, index) => ({ index, text: cleanCaption(x.text) }));
  const prompt = `这是一页学术论文。请找出下列图注所对应的完整图形或表格区域。裁切范围应包含图形内部标题、图例和子图标签，但不包含图形下方的原始图注；排除页眉、页脚和相邻正文。
图注：${JSON.stringify(captions)}
坐标使用相对于整页的 [x, y, width, height]，左上角为原点，数值为 0 到 1。只输出 JSON：{"figures":[{"captionIndex":0,"bbox":[0.1,0.2,0.8,0.4]}]}。无法可靠定位的图注不要返回。`;
  const result = await visionJson(cfg, prompt, image.buffer);
  return (result.figures || [])
    .filter(item => Number.isInteger(item.captionIndex) && page.captions[item.captionIndex] && validBox(item.bbox))
    .map(item => ({ captionIndex: item.captionIndex, bbox: item.bbox, method: 'vision' }));
}

async function saveCrop(rendered, box, output) {
  const [x, y, width, height] = box;
  const left = Math.max(0, Math.floor(x * rendered.width));
  const top = Math.max(0, Math.floor(y * rendered.height));
  const cropWidth = Math.min(rendered.width - left, Math.ceil(width * rendered.width));
  const cropHeight = Math.min(rendered.height - top, Math.ceil(height * rendered.height));
  if (cropWidth < 180 || cropHeight < 100) throw new Error('识别到的图片区域过小。');
  await sharp(rendered.buffer)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .png({ compressionLevel: 8 })
    .toFile(output);
  return { left, top, width: cropWidth, height: cropHeight };
}

export async function extractFigures(pdfFile, parsed, assetsDir, cfg, onLog = () => {}, maxFigures = 6) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const candidatePages = parsed.pages.filter(page => page.captions.length).slice(0, 10);
  const figures = [];
  let visionUnavailable = false;
  for (const page of candidatePages) {
    if (figures.length >= maxFigures) break;
    onLog(`分析第 ${page.page} 页的图注与图片区域`);
    const rendered = await renderPage(pdfFile, page.page);
    let boxes = [];
    let visionConfirmed = false;
    if (!visionUnavailable && cfg.llmApiKey && (cfg.visionModel || cfg.llmModel)) {
      try { boxes = await locateWithVision(cfg, page, rendered); visionConfirmed = true; }
      catch (error) {
        visionUnavailable = true;
        onLog(`视觉定位服务不可用，本篇后续图片使用坐标裁切：${error.message}`, 'warn');
      }
    }
    const byCaption = new Map(boxes.map(item => [item.captionIndex, item]));
    for (const fallback of visionConfirmed ? [] : fallbackBoxes(page)) {
      if (!byCaption.has(fallback.captionIndex)) byCaption.set(fallback.captionIndex, fallback);
    }
    for (const item of [...byCaption.values()].sort((a, b) => a.captionIndex - b.captionIndex)) {
      if (figures.length >= maxFigures) break;
      const id = `fig-${String(figures.length + 1).padStart(2, '0')}`;
      const file = path.join(assetsDir, `${id}.png`);
      try {
        const pixelBox = await saveCrop(rendered, item.bbox, file);
        figures.push({
          id,
          file,
          page: page.page,
          caption: cleanCaption(page.captions[item.captionIndex].text),
          bbox: item.bbox,
          pixelBox,
          method: item.method
        });
      } catch (error) {
        onLog(`跳过第 ${page.page} 页的异常裁切区域：${error.message}`, 'warn');
      }
    }
  }
  return figures;
}
