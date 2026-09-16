// 카메라 프레임을 분석해서 "너무 가깝다 / 너무 멀다 / 어둡다 / 흔들린다 / 좋다"를
// 판단하는 경량 휴리스틱 모듈. 실제 딥러닝 문서 인식 모델이 아니라,
// Canvas 픽셀 데이터를 이용한 밝기·엣지 밀도·라플라시안 분산(초점 지표) 계산이다.
// 프로토타입 수준의 근사치이며, 실제 서비스에서는 더 정교한 문서 경계 인식이 필요하다.

const FrameQuality = (() => {
  const SAMPLE_W = 96;
  const SAMPLE_H = 72;

  const DARK_THRESHOLD = 60;
  const BRIGHT_THRESHOLD = 205;
  const EDGE_MIN = 0.02; // 이보다 낮으면: 콘텐츠가 거의 안 보임(너무 멀거나 빈 화면)
  const BORDER_EDGE_MAX = 0.11; // 테두리 부분에도 콘텐츠가 꽉 차면: 너무 가까움
  const SHARPNESS_MIN = 3.5; // 라플라시안 분산 최소값(임의 임계치, 실기기 보정 필요)

  const offCanvas = document.createElement('canvas');
  offCanvas.width = SAMPLE_W;
  offCanvas.height = SAMPLE_H;
  const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

  function analyze(videoEl) {
    offCtx.drawImage(videoEl, 0, 0, SAMPLE_W, SAMPLE_H);
    const { data } = offCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
    const gray = new Float32Array(SAMPLE_W * SAMPLE_H);
    let brightnessSum = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gray[p] = g;
      brightnessSum += g;
    }
    const brightness = brightnessSum / gray.length;

    let lapSum = 0;
    let lapSqSum = 0;
    let edgeCount = 0;
    let borderEdgeCount = 0;
    let borderTotal = 0;
    const marginX = Math.floor(SAMPLE_W * 0.15);
    const marginY = Math.floor(SAMPLE_H * 0.15);

    for (let y = 1; y < SAMPLE_H - 1; y++) {
      for (let x = 1; x < SAMPLE_W - 1; x++) {
        const idx = y * SAMPLE_W + x;
        const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - SAMPLE_W] - gray[idx + SAMPLE_W];
        lapSum += lap;
        lapSqSum += lap * lap;
        const isEdge = Math.abs(lap) > 18;
        if (isEdge) edgeCount++;
        const isBorder = x < marginX || x >= SAMPLE_W - marginX || y < marginY || y >= SAMPLE_H - marginY;
        if (isBorder) {
          borderTotal++;
          if (isEdge) borderEdgeCount++;
        }
      }
    }

    const total = (SAMPLE_W - 2) * (SAMPLE_H - 2);
    const lapMean = lapSum / total;
    const sharpness = lapSqSum / total - lapMean * lapMean;
    const edgeDensity = edgeCount / total;
    const borderDensity = borderTotal ? borderEdgeCount / borderTotal : 0;

    return { brightness, sharpness, edgeDensity, borderDensity };
  }

  function evaluate(metrics) {
    if (metrics.brightness < DARK_THRESHOLD) {
      return { status: 'dark', message: '너무 어둡습니다. 밝은 곳에서 비춰주세요.' };
    }
    if (metrics.brightness > BRIGHT_THRESHOLD) {
      return { status: 'bright', message: '빛이 너무 강하게 반사됩니다. 각도를 조금 바꿔주세요.' };
    }
    if (metrics.edgeDensity < EDGE_MIN) {
      return { status: 'far', message: '학습 자료가 잘 보이지 않습니다. 조금 더 가까이 대주세요.' };
    }
    if (metrics.borderDensity > BORDER_EDGE_MAX) {
      return { status: 'close', message: '너무 가깝습니다. 조금 멀리서 비춰주세요.' };
    }
    if (metrics.sharpness < SHARPNESS_MIN) {
      return { status: 'blurry', message: '초점이 흐립니다. 손을 잠시 고정해주세요.' };
    }
    return { status: 'good', message: '좋습니다. 그대로 유지해주세요.' };
  }

  return { analyze, evaluate };
})();

// 클래식 스크립트의 top-level const는 window에 붙지 않으므로, 다른 스크립트에서
// window.FrameQuality로 존재 여부를 확인할 수 있도록 명시적으로 노출한다(pdfImport.js와 동일한 방식).
window.FrameQuality = FrameQuality;
