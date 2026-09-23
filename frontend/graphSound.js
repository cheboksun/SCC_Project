// 그래프 모양을 소리(음높이 변화)와 진동 패턴으로 변환해서 들려주는 모듈.
// Web Vibration API는 안드로이드 크롬 등 일부 브라우저에서만 동작하므로,
// 모든 환경에서 동작하는 오디오(음높이 변화)를 기본 채널로 사용한다.

const GraphSound = (() => {
  const DURATION = 3.2; // 초
  const SAMPLES = 80;
  const MIN_FREQ = 220; // A3
  const MAX_FREQ = 880; // A5

  const GRAPH_TYPES = [
    {
      id: 'linear_up',
      label: '1차함수 (기울기 양수, 우상향 직선)',
      desc: '낮은 음에서 시작해서 끝까지 일정하게 높아지는 소리입니다. 오른쪽 위로 올라가는 직선을 의미해요.',
      fn: (x) => x,
    },
    {
      id: 'linear_down',
      label: '1차함수 (기울기 음수, 우하향 직선)',
      desc: '높은 음에서 시작해서 끝까지 일정하게 낮아지는 소리입니다. 오른쪽 아래로 내려가는 직선을 의미해요.',
      fn: (x) => 1 - x,
    },
    {
      id: 'quadratic_up',
      label: '2차함수 (아래로 볼록한 포물선)',
      desc: '높은 음에서 시작해 중간에 가장 낮아졌다가 다시 높아지는 소리입니다. U자 모양 포물선을 의미해요.',
      fn: (x) => 4 * Math.pow(x - 0.5, 2),
    },
    {
      id: 'quadratic_down',
      label: '2차함수 (위로 볼록한 포물선)',
      desc: '낮은 음에서 시작해 중간에 가장 높아졌다가 다시 낮아지는 소리입니다. 뒤집힌 U자(∩) 모양 포물선을 의미해요.',
      fn: (x) => 1 - 4 * Math.pow(x - 0.5, 2),
    },
    {
      id: 'sine',
      label: '삼각함수 (사인 곡선, 파도 모양)',
      desc: '음이 높아졌다 낮아졌다를 두 번 반복하는, 파도처럼 굽이치는 소리입니다.',
      fn: (x) => (Math.sin(2 * Math.PI * x * 2) + 1) / 2,
    },
    {
      id: 'exponential',
      label: '지수함수 (처음엔 완만, 나중엔 급격히 증가)',
      desc: '처음에는 거의 변화가 없다가 뒤로 갈수록 음이 매우 빠르게 높아지는 소리입니다.',
      fn: (x) => (Math.exp(3 * x) - 1) / (Math.exp(3) - 1),
    },
    {
      id: 'logarithm',
      label: '로그함수 (처음엔 급격, 나중엔 완만히 증가)',
      desc: '처음에는 음이 빠르게 높아지다가 뒤로 갈수록 변화가 완만해지는 소리입니다.',
      fn: (x) => Math.log(1 + 9 * (x + 0.001)) / Math.log(10.009),
    },
    {
      id: 'circle',
      label: '원 (닫힌 곡선)',
      desc: '시작 음과 끝나는 음의 높이가 같도록 한 바퀴를 도는 소리입니다. 원처럼 닫혀 있는 도형을 의미해요.',
      fn: (x) => (Math.sin(2 * Math.PI * x) + 1) / 2,
    },
  ];

  let muted = false; // 프로토타입 테스트용 소리 끄기
  function setMuted(value) {
    muted = value;
  }
  function isMuted() {
    return muted;
  }

  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor();
    }
    return audioCtx;
  }

  function buildCurve(fn) {
    const curve = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const x = i / (SAMPLES - 1);
      const y = Math.max(0, Math.min(1, fn(x)));
      curve[i] = MIN_FREQ + y * (MAX_FREQ - MIN_FREQ);
    }
    return curve;
  }

  const VIBRATION_SEGMENTS = 32; // 세밀하게 나눌수록 곡선 굴곡이 더 잘 느껴짐

  function buildVibrationPattern(fn) {
    // 전체 길이를 DURATION(오디오 재생 시간)에 정확히 맞춰서, 소리의 음높이 변화와
    // 같은 순간에 같은 굴곡의 진동이 느껴지도록 동기화한다.
    const segmentMs = (DURATION * 1000) / VIBRATION_SEGMENTS;
    const pattern = [];
    for (let i = 0; i < VIBRATION_SEGMENTS; i++) {
      // 구간 중앙 시점의 값을 사용 (오디오 커브와 같은 시점의 굴곡을 대표)
      const x = (i + 0.5) / VIBRATION_SEGMENTS;
      const y = Math.max(0, Math.min(1, fn(x)));
      // Vibration API는 세기 조절이 안 되므로, 값이 클수록 구간 내에서
      // 진동이 켜져 있는 비율(듀티 사이클)을 높여 강약 차이를 표현한다.
      const onRatio = 0.25 + y * 0.65; // 0.25~0.9, 완전 무음/완전 진동 방지
      const onMs = Math.round(segmentMs * onRatio);
      const offMs = Math.max(0, Math.round(segmentMs - onMs));
      pattern.push(onMs, offMs);
    }
    return pattern;
  }

  // fn(x)는 x가 0~1일 때 이미 0~1 범위의 값을 반환한다고 가정한다(canned 함수/normalizeFn() 결과 전용).
  function playFn(fn, meta) {
    if (muted) return null;

    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const curve = buildCurve(fn);
    osc.frequency.setValueCurveAtTime(curve, ctx.currentTime, DURATION);

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.35, ctx.currentTime + DURATION - 0.1);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + DURATION);

    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + DURATION);

    // navigator.vibrate()는 호출이 수락돼도(true) 기기의 무음/진동 설정에 따라
    // 실제로는 울리지 않을 수 있고, 브라우저가 거부하면 false를 반환한다.
    // 화면에서 바로 원인을 구분할 수 있도록 결과를 함께 반환한다.
    let vibrateInfo = '이 브라우저는 진동 API를 지원하지 않습니다.';
    if (navigator.vibrate) {
      try {
        const accepted = navigator.vibrate(buildVibrationPattern(fn));
        vibrateInfo = accepted
          ? '진동 요청이 수락됐습니다. (기기가 실제로 울리지 않으면 무음/진동 설정을 확인해주세요)'
          : '브라우저가 진동 요청을 거부했습니다(false 반환).';
      } catch (e) {
        vibrateInfo = `진동 요청 중 오류: ${e.message}`;
      }
    }

    return { ...meta, vibrateInfo };
  }

  function play(id) {
    const type = GRAPH_TYPES.find((g) => g.id === id);
    if (!type) return null;
    return playFn(type.fn, type);
  }

  // 실제 방정식 fn(정의역 domainMin~domainMax, 값 범위 임의)을 0~1로 정규화한 함수로 바꾼다.
  // 손으로 따라 그리기(GraphTrace)와 재생(playFromEquation)이 이 정규화를 공유한다.
  function normalizeFn(fn, domainMin, domainMax) {
    const ys = [];
    for (let i = 0; i < SAMPLES; i++) {
      const x = domainMin + (i / (SAMPLES - 1)) * (domainMax - domainMin);
      let y;
      try { y = fn(x); } catch (e) { y = NaN; }
      if (Number.isFinite(y)) ys.push(y);
    }
    if (!ys.length) return null;
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const range = yMax - yMin || 1;
    return (t) => {
      const x = domainMin + t * (domainMax - domainMin);
      let y;
      try { y = fn(x); } catch (e) { y = yMin; }
      if (!Number.isFinite(y)) y = yMin;
      return (y - yMin) / range;
    };
  }

  // 방정식에서 뽑아낸 실제 함수를 정규화해서 재생한다. 정규화 실패(값 전부 무한대 등)시 null 반환.
  function playFromEquation(fn, domainMin, domainMax, meta) {
    const normFn = normalizeFn(fn, domainMin, domainMax);
    if (!normFn) return null;
    return playFn(normFn, meta);
  }

  return { GRAPH_TYPES, play, playFromEquation, normalizeFn, DURATION, setMuted, isMuted };
})();

// 클래식 스크립트의 top-level const는 window에 붙지 않으므로, 다른 스크립트에서
// window.GraphSound로 존재 여부를 확인할 수 있도록 명시적으로 노출한다(pdfImport.js와 동일한 방식).
window.GraphSound = GraphSound;
