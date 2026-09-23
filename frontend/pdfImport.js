// PDF 파일에서 목차(북마크)와 페이지별 텍스트/이미지를 뽑아내는 래퍼.
// 이 프로젝트는 빌드 도구가 없어서 pdf.js를 CDN의 ESM 빌드로 바로 불러온다.
// pdf.js 최근 버전은 ESM 전용(.mjs)이라 이 파일 자체를 <script type="module">로 로드한다
// (module 스크립트는 defer처럼 동작해서, 이 파일이 window.PdfImport를 채우는 시점은
// 문서 파싱이 끝난 뒤이지만, 다른 스크립트들은 사용자 상호작용 이후에만 PdfImport를 호출하므로 문제 없음).

// 6.1.200(최신)은 일부 Safari 버전에서 "undefined is not a function"으로 즉시 깨져서
// (아마도 아주 최근 JS 문법/API를 쓰는 듯) 더 널리 호환되는 4.x 최신 안정 버전으로 고정했다.
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

// 한글 PDF는 대부분 CID 폰트를 쓰는데, 글자→유니코드 표(ToUnicode)가 없는 파일(예: macOS "PDF로 저장")은
// CMap 파일이 없으면 pdf.js가 한글을 전부 버리고 "1 . ." 같은 숫자·기호만 돌려준다.
// cdnjs에는 cmaps가 없어서(403) 같은 버전의 jsDelivr 사본을 쓴다.
const PDFJS_ASSETS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';

const PdfImport = (() => {
  async function openPdf(file) {
    const data = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({
      data,
      cMapUrl: PDFJS_ASSETS + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDFJS_ASSETS + 'standard_fonts/',
    });
    return loadingTask.promise;
  }

  // 북마크(outline)를 [{ title, startPageIndex }] (0-based, startPageIndex 오름차순)로 정규화한다.
  // 페이지로 해석 안 되는 항목은 건너뛰고, 중첩된 하위 항목은 v1에서는 다루지 않는다(최상위 단원 단위로 충분).
  // 북마크가 없거나 하나도 페이지로 해석 못 하면 null(= 결정론적 목차를 못 만듦, AI 폴백 필요).
  async function extractOutline(pdfDoc) {
    const outline = await pdfDoc.getOutline();
    if (!outline || !outline.length) return null;

    const resolved = [];
    for (const item of outline) {
      try {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
        if (!dest || !dest[0]) continue;
        const pageIndex = await pdfDoc.getPageIndex(dest[0]);
        resolved.push({ title: (item.title || '').trim(), startPageIndex: pageIndex });
      } catch (e) {
        // 이 항목은 페이지로 해석하지 못함 -> 건너뜀
      }
    }
    if (!resolved.length) return null;
    resolved.sort((a, b) => a.startPageIndex - b.startPageIndex);
    return resolved;
  }

  // pageIndex(0-based)가 속한 outline 항목을 찾는다(다음 항목 시작 전까지가 이 항목의 범위).
  function findOutlineEntryForPage(outline, pageIndex) {
    let match = null;
    for (const entry of outline) {
      if (entry.startPageIndex <= pageIndex) match = entry;
      else break;
    }
    return match;
  }

  // 텍스트 레이어가 있는 페이지면 OCR 없이 바로 텍스트를 얻는다. 사실상 비어있거나(스캔 이미지 PDF)
  // 글자는 없고 숫자·기호만 남은 경우(폰트를 해석하지 못함)는 null을 반환해서
  // 호출부가 renderPageToDataUrl + OCR로 폴백하게 한다.
  async function extractPageText(pdfDoc, pageIndex) {
    const page = await pdfDoc.getPage(pageIndex + 1); // pdf.js 페이지 번호는 1부터 시작
    const content = await page.getTextContent();
    // 공백은 pdf.js가 별도 항목으로 넣어주므로 그대로 이어 붙이고, 줄 끝(hasEOL)만 띄어쓴다.
    // (예전처럼 항목마다 공백을 넣으면 "1 단원", "핍니다 ." 처럼 글자 사이가 벌어진다.)
    const text = content.items
      .map((it) => (it.str || '') + (it.hasEOL ? ' ' : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    const letterCount = (text.match(/\p{L}/gu) || []).length;
    return text.length >= 5 && letterCount >= 3 ? text : null;
  }

  async function renderPageToDataUrl(pdfDoc, pageIndex, scale = 1.5) {
    const page = await pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  return { openPdf, extractOutline, findOutlineEntryForPage, extractPageText, renderPageToDataUrl };
})();

window.PdfImport = PdfImport;
