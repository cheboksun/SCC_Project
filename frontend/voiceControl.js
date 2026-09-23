// 마이크를 상시 켜두고 계속 듣는 모듈. speech.js가 TTS로 말하는 동안에는
// 자동으로 음소거(mute)했다가 말이 끝나면 다시 듣기(unmute)를 재개해서
// AI 음성을 마이크가 되받아 인식하는 되울림(피드백)을 막는다.

const VoiceControl = (() => {
  let recognition = null;
  let shouldListen = false;
  let muted = false;
  let isRunning = false;
  let onFinalCallback = null;
  let restartTimer = null;

  function getCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  function supported() {
    return !!getCtor();
  }

  function ensureRecognition() {
    if (recognition) return recognition;
    const Ctor = getCtor();
    recognition = new Ctor();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
      isRunning = true;
    };
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last && last.isFinal) {
        const transcript = last[0].transcript.trim();
        if (transcript && onFinalCallback) onFinalCallback(transcript);
      }
    };
    recognition.onerror = () => {
      // no-speech, aborted 등은 onend에서 재시작 로직으로 처리한다.
    };
    recognition.onend = () => {
      isRunning = false;
      if (shouldListen && !muted) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (shouldListen && !muted && !isRunning) safeStart();
        }, 300);
      }
    };
    return recognition;
  }

  function safeStart() {
    try {
      ensureRecognition().start();
    } catch (e) {
      // 이미 시작된 인식기를 다시 시작하려 할 때 발생하는 오류는 무시한다.
    }
  }

  function safeStop() {
    try {
      if (recognition) recognition.stop();
    } catch (e) {
      // no-op
    }
  }

  // onFinal 콜백만 새 화면 맥락으로 교체하고, 이미 듣고 있으면 재시작하지 않는다.
  function start(onFinal) {
    if (!supported()) return false;
    onFinalCallback = onFinal;
    shouldListen = true;
    if (!muted && !isRunning) safeStart();
    return true;
  }

  function stop() {
    shouldListen = false;
    clearTimeout(restartTimer);
    safeStop();
  }

  function mute() {
    muted = true;
    clearTimeout(restartTimer);
    safeStop();
  }

  function unmute() {
    if (!muted) return;
    muted = false;
    if (shouldListen && !isRunning) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (shouldListen && !muted && !isRunning) safeStart();
      }, 250);
    }
  }

  return { start, stop, mute, unmute, supported };
})();

// 클래식 스크립트의 top-level const는 window에 붙지 않으므로, 다른 스크립트에서
// window.VoiceControl로 존재 여부를 확인할 수 있도록 명시적으로 노출한다(pdfImport.js와 동일한 방식).
window.VoiceControl = VoiceControl;
