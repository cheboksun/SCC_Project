// 그래프 모양을 손가락으로 따라 그려보는 모듈.
// 사용자가 화면(트레이스 영역, <canvas>)을 손가락으로 누르고 좌->우로 움직이면,
// 현재 손가락 위치(x, y)를 그래프 함수 값과 비교해서 잘 따라가고 있을 때만 진동을 준다.
// 진동이 계속 느껴지면 "지금 손이 그래프 위에 있다"는 뜻, 끊기면 궤적을 벗어난 것.
// 저시력 사용자나 옆에서 도와주는 사람을 위해 실제 그래프 모양도 캔버스에 선으로 그려둔다.

const GraphTrace = (() => {
  const TOLERANCE = 0.09; // 이 안이면 "그래프 위"로 판정
  const VIBRATE_MS = 15; // 한 번의 진동 펄스 길이
  const VIBRATE_COOLDOWN_MS = 40; // 과도하게 자주 재호출하지 않도록 최소 간격

  let fn = null;
  let el = null;
  let tracking = false;
  let lastVibrateAt = -Infinity;

  function resizeCanvas() {
    if (!el || typeof el.getContext !== 'function') return;
    const dpr = window.devicePixelRatio || 1;
    const rect = el.getBoundingClientRect();
    el.width = Math.round(rect.width * dpr);
    el.height = Math.round(rect.height * dpr);
    el.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!el || typeof el.getContext !== 'function' || !fn) return;
    const ctx = el.getContext('2d');
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const rootStyle = getComputedStyle(document.documentElement);
    const lineColor = rootStyle.getPropertyValue('--accent').trim() || '#6cb4ff';
    const gridColor = rootStyle.getPropertyValue('--border').trim() || '#3a4050';

    // 가운데 기준선(참고용)
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // 실제 그래프 곡선
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const STEPS = 100;
    for (let i = 0; i <= STEPS; i++) {
      const x = i / STEPS;
      const y = Math.max(0, Math.min(1, fn(x)));
      const px = x * w;
      const py = (1 - y) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function normalize(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // 화면 좌표는 아래로 갈수록 커지므로, 위쪽이 큰 값이 되도록 뒤집는다.
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    return { x, y };
  }

  function handlePoint(clientX, clientY) {
    if (!fn || !el) return;
    const { x, y } = normalize(clientX, clientY);
    const expected = Math.max(0, Math.min(1, fn(x)));
    const diff = Math.abs(y - expected);
    if (diff > TOLERANCE) return;

    const now = performance.now();
    if (!navigator.vibrate) return;
    if (now - lastVibrateAt < VIBRATE_COOLDOWN_MS) return;
    navigator.vibrate(VIBRATE_MS);
    lastVibrateAt = now;
  }

  function onTouchStart(e) {
    tracking = true;
    e.preventDefault();
    const t = e.touches[0];
    if (t) handlePoint(t.clientX, t.clientY);
  }
  function onTouchMove(e) {
    if (!tracking) return;
    e.preventDefault();
    const t = e.touches[0];
    if (t) handlePoint(t.clientX, t.clientY);
  }
  function onTouchEnd() {
    tracking = false;
  }

  // 진동이 없는 데스크톱에서도 동작 확인은 할 수 있도록 마우스도 지원(터치와 중복 방지).
  function onPointerDown(e) {
    if (e.pointerType === 'touch') return;
    tracking = true;
    handlePoint(e.clientX, e.clientY);
  }
  function onPointerMove(e) {
    if (!tracking || e.pointerType === 'touch') return;
    handlePoint(e.clientX, e.clientY);
  }
  function onPointerUp(e) {
    if (e.pointerType === 'touch') return;
    tracking = false;
  }

  function bind(element) {
    el = element;
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerUp);
    window.addEventListener('resize', () => {
      if (!el.hidden) { resizeCanvas(); draw(); }
    });
  }

  function setGraphFn(newFn) {
    fn = newFn;
    resizeCanvas();
    draw();
  }

  return { bind, setGraphFn };
})();

// 클래식 스크립트의 top-level const는 window에 붙지 않으므로, 다른 스크립트에서
// window.GraphTrace로 존재 여부를 확인할 수 있도록 명시적으로 노출한다(pdfImport.js와 동일한 방식).
window.GraphTrace = GraphTrace;
