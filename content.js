// YouTube Script Translator - Content Script

(function() {
  'use strict';

  let panel = null;
  let currentTranscript = [];
  let originalText = '';
  let translatedText = '';
  let isShowingTranslation = false;

  // ANDROID 클라이언트로 InnerTube API 호출하여 자막 트랙 가져오기
  async function getCaptionTracks(videoId) {
    try {
      // 페이지에서 API 키 추출
      const html = document.documentElement.innerHTML;
      const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
      if (!apiKeyMatch) {
        console.error('API 키를 찾을 수 없음');
        return [];
      }
      const apiKey = apiKeyMatch[1];

      // ANDROID 클라이언트로 요청 (exp=xpe 파라미터가 없는 URL을 받음)
      const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
          videoId: videoId
        })
      });

      const data = await res.json();
      return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    } catch (e) {
      console.error('자막 트랙 가져오기 실패:', e);
      return [];
    }
  }

  // 자막 트랙 선택 (원어 우선)
  function selectBestTrack(tracks) {
    if (!tracks || tracks.length === 0) return null;

    // 1. 수동 자막 (원어) 우선
    const manualTrack = tracks.find(t => t.kind !== 'asr');
    if (manualTrack) return manualTrack;

    // 2. 자동 생성 자막
    return tracks[0];
  }

  // 자막 XML 가져오기
  async function fetchTranscript(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    if (!xml) throw new Error('빈 응답');

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const texts = doc.querySelectorAll('text');

    const transcript = [];
    texts.forEach(t => {
      const start = parseFloat(t.getAttribute('start') || 0);
      let text = t.textContent || '';
      const textarea = document.createElement('textarea');
      textarea.innerHTML = text;
      text = textarea.value.replace(/\n/g, ' ').trim();
      if (text) {
        transcript.push({ start, text });
      }
    });
    return transcript;
  }

  const DEFAULT_PROMPT = `{text}

번역해줘.`;

  // Gemini API로 번역
  async function translateWithGemini(text) {
    const result = await chrome.storage.sync.get(['geminiApiKey', 'translatePrompt']);
    const apiKey = result.geminiApiKey;
    const promptTemplate = result.translatePrompt || DEFAULT_PROMPT;

    if (!apiKey) {
      throw new Error('Gemini API 키가 설정되지 않았습니다.\n확장 프로그램 설정에서 API 키를 입력하세요.');
    }

    // {text}를 실제 텍스트로 치환
    const prompt = promptTemplate.replace('{text}', text);

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error?.message || `API 오류: ${res.status}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '번역 실패';
  }

  let segmentMinutes = 30; // 기본 30분

  // 트랜스크립트를 구간별로 그룹핑
  function groupBySegment(transcript, segmentSeconds) {
    const segments = [];
    let current = { startSec: 0, endSec: segmentSeconds, items: [] };

    for (const item of transcript) {
      while (item.start >= current.endSec) {
        if (current.items.length > 0) segments.push(current);
        const nextStart = current.endSec;
        current = { startSec: nextStart, endSec: nextStart + segmentSeconds, items: [] };
      }
      current.items.push(item);
    }
    if (current.items.length > 0) segments.push(current);
    return segments;
  }

  // 초를 mm:ss 또는 hh:mm:ss로 포맷
  function formatTimePlain(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }

  // 타임스탬프 포맷
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `[${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}]`;
    }
    return `[${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}]`;
  }

  // 패널 생성
  function createPanel() {
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'yt-script-panel';
    panel.innerHTML = `
      <div class="yt-script-header">
        <span>스크립트</span>
        <div class="yt-script-controls">
          <label><input type="checkbox" id="yt-script-timestamp" checked> 타임스탬프</label>
          <button id="yt-script-copy">복사</button>
          <button id="yt-script-close">✕</button>
        </div>
      </div>
      <div class="yt-script-actions">
        <button id="yt-script-original" class="active">원본</button>
        <button id="yt-script-translate">번역</button>
      </div>
      <div id="yt-script-content">로딩중...</div>
    `;
    document.body.appendChild(panel);

    document.getElementById('yt-script-close').onclick = () => panel.style.display = 'none';
    document.getElementById('yt-script-copy').onclick = copyToClipboard;
    document.getElementById('yt-script-timestamp').onchange = () => {
      translatedText = ''; // 타임스탬프 변경 시 번역 캐시 초기화
      if (isShowingTranslation) {
        isShowingTranslation = false;
        document.getElementById('yt-script-original').classList.add('active');
        document.getElementById('yt-script-translate').classList.remove('active');
      }
      displayContent();
    };
    document.getElementById('yt-script-original').onclick = showOriginal;
    document.getElementById('yt-script-translate').onclick = translateScript;

    return panel;
  }

  // 원본 보기
  function showOriginal() {
    isShowingTranslation = false;
    document.getElementById('yt-script-original').classList.add('active');
    document.getElementById('yt-script-translate').classList.remove('active');
    displayContent();
  }

  // 번역 보기/실행
  async function translateScript() {
    const content = document.getElementById('yt-script-content');
    const translateBtn = document.getElementById('yt-script-translate');
    const withTimestamp = document.getElementById('yt-script-timestamp').checked;

    if (translatedText) {
      // 이미 번역됨 - 토글
      isShowingTranslation = true;
      document.getElementById('yt-script-original').classList.remove('active');
      translateBtn.classList.add('active');
      displayContent();
      return;
    }

    // 번역 실행
    translateBtn.textContent = '번역중...';
    translateBtn.disabled = true;

    // 타임스탬프 포함 여부에 따라 텍스트 구성
    const textToTranslate = withTimestamp
      ? currentTranscript.map(t => `${formatTime(t.start)} ${t.text}`).join('\n')
      : originalText;

    try {
      translatedText = await translateWithGemini(textToTranslate);
      isShowingTranslation = true;
      document.getElementById('yt-script-original').classList.remove('active');
      translateBtn.classList.add('active');
      translateBtn.textContent = '번역';
      translateBtn.disabled = false;
      displayContent();
    } catch (e) {
      content.textContent = '번역 오류: ' + e.message;
      translateBtn.textContent = '번역';
      translateBtn.disabled = false;
    }
  }

  // 구간 복사 버튼 클릭 핸들러
  async function copySegmentText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '복사됨!';
      setTimeout(() => btn.textContent = orig, 1500);
    } catch (e) {
      alert('복사 실패: ' + e.message);
    }
  }

  // 번역 텍스트를 타임스탬프 기준으로 구간 분할
  function splitTranslatedBySegments(translated, segments) {
    const lines = translated.split('\n');
    const segmentTexts = [];
    let lineIdx = 0;

    for (const seg of segments) {
      const segLines = [];
      // 이 구간의 아이템 수만큼 줄을 할당
      const count = seg.items.length;
      for (let i = 0; i < count && lineIdx < lines.length; i++, lineIdx++) {
        segLines.push(lines[lineIdx]);
      }
      segmentTexts.push(segLines.join('\n'));
    }
    // 남은 줄이 있으면 마지막 구간에 추가
    if (lineIdx < lines.length) {
      const remaining = lines.slice(lineIdx).join('\n');
      if (segmentTexts.length > 0) {
        segmentTexts[segmentTexts.length - 1] += '\n' + remaining;
      }
    }
    return segmentTexts;
  }

  // 컨텐츠 표시
  function displayContent() {
    const content = document.getElementById('yt-script-content');
    const withTimestamp = document.getElementById('yt-script-timestamp').checked;

    if (currentTranscript.length === 0) {
      content.textContent = '자막이 없습니다.';
      return;
    }

    const segments = groupBySegment(currentTranscript, segmentMinutes * 60);
    const needSegments = segments.length > 1;

    if (!needSegments) {
      // 구간이 1개면 기존 방식 그대로
      if (isShowingTranslation && translatedText) {
        content.textContent = translatedText;
      } else if (withTimestamp) {
        content.textContent = currentTranscript
          .map(t => `${formatTime(t.start)} ${t.text}`)
          .join('\n');
      } else {
        content.textContent = originalText;
      }
      return;
    }

    // 구간이 여러 개: HTML로 렌더링
    content.innerHTML = '';

    let segmentTexts = null;
    if (isShowingTranslation && translatedText) {
      segmentTexts = splitTranslatedBySegments(translatedText, segments);
    }

    segments.forEach((seg, i) => {
      const rangeLabel = `${formatTimePlain(seg.startSec)}~${formatTimePlain(seg.endSec)}`;

      // 구간 헤더 (복사 버튼)
      const btn = document.createElement('button');
      btn.className = 'yt-script-segment-copy';
      btn.textContent = `[${rangeLabel}] 복사`;

      // 구간 텍스트 생성
      let segText;
      if (isShowingTranslation && segmentTexts) {
        segText = segmentTexts[i] || '';
      } else if (withTimestamp) {
        segText = seg.items.map(t => `${formatTime(t.start)} ${t.text}`).join('\n');
      } else {
        segText = seg.items.map(t => t.text).join(' ');
      }

      btn.onclick = () => copySegmentText(segText, btn);

      // 텍스트 영역
      const textEl = document.createElement('div');
      textEl.className = 'yt-script-segment-text';
      textEl.textContent = segText;

      content.appendChild(btn);
      content.appendChild(textEl);
    });
  }

  // 클립보드 복사
  async function copyToClipboard() {
    const content = document.getElementById('yt-script-content');
    try {
      await navigator.clipboard.writeText(content.textContent);
      const btn = document.getElementById('yt-script-copy');
      btn.textContent = '복사됨!';
      setTimeout(() => btn.textContent = '복사', 1500);
    } catch (e) {
      alert('복사 실패: ' + e.message);
    }
  }

  // 메인 로직
  async function loadScript() {
    createPanel();
    panel.style.display = 'flex';

    const content = document.getElementById('yt-script-content');
    content.textContent = '로딩중...';
    currentTranscript = [];
    originalText = '';
    translatedText = '';
    isShowingTranslation = false;

    // 버튼 상태 초기화
    document.getElementById('yt-script-original').classList.add('active');
    document.getElementById('yt-script-translate').classList.remove('active');

    // 설정 로드
    const { geminiApiKey, segmentMin } = await chrome.storage.sync.get(['geminiApiKey', 'segmentMin']);
    segmentMinutes = segmentMin || 30;
    const translateBtn = document.getElementById('yt-script-translate');
    if (!geminiApiKey) {
      translateBtn.disabled = true;
      translateBtn.title = 'Gemini API 키를 설정에서 입력하세요';
    } else {
      translateBtn.disabled = false;
      translateBtn.title = '';
    }

    try {
      const videoId = new URLSearchParams(location.search).get('v');
      if (!videoId) {
        content.textContent = '비디오 ID를 찾을 수 없습니다.';
        return;
      }

      const tracks = await getCaptionTracks(videoId);

      if (!tracks || tracks.length === 0) {
        content.textContent = '이 영상에는 자막이 없습니다.';
        return;
      }

      // 원어(수동) 자막 우선 선택
      const track = selectBestTrack(tracks);
      const langName = track.name?.runs?.[0]?.text || track.name?.simpleText || track.languageCode;
      const isAuto = track.kind === 'asr' ? ' (자동생성)' : '';

      content.textContent = `자막 로딩중... (${langName}${isAuto})`;

      // fmt=srv3 제거 (XML 형식으로 받기 위해)
      const captionUrl = track.baseUrl.replace('&fmt=srv3', '');
      currentTranscript = await fetchTranscript(captionUrl);

      if (currentTranscript.length === 0) {
        content.textContent = '자막을 가져올 수 없습니다.';
        return;
      }

      originalText = currentTranscript.map(t => t.text).join(' ');
      displayContent();

    } catch (e) {
      content.textContent = '오류: ' + e.message;
      console.error('YouTube Script Translator:', e);
    }
  }

  // 버튼 요소 생성
  function createButtonContainer() {
    const container = document.createElement('div');
    container.className = 'yt-script-btn-container';

    const btn = document.createElement('button');
    btn.className = 'yt-script-btn-sidebar';
    btn.textContent = '📜 스크립트 보기';
    btn.onclick = loadScript;

    container.appendChild(btn);
    return container;
  }

  // 버튼 삽입 (사이드바 + 영상 아래 둘 다)
  function insertButton() {
    let inserted = false;

    // 사이드바 (넓은 화면)
    const secondary = document.querySelector('#secondary-inner, #secondary');
    if (secondary && !secondary.querySelector('.yt-script-btn-container')) {
      secondary.insertBefore(createButtonContainer(), secondary.firstChild);
      inserted = true;
    }

    // 영상 아래 (좁은 화면)
    const below = document.querySelector('#below');
    if (below && !below.querySelector(':scope > .yt-script-btn-container')) {
      below.insertBefore(createButtonContainer(), below.firstChild);
      inserted = true;
    }

    return inserted || !!document.querySelector('.yt-script-btn-container');
  }

  // 초기화
  function init() {
    const tryInsert = () => {
      if (!insertButton()) {
        setTimeout(tryInsert, 1000);
      }
    };
    tryInsert();

    // 단축키로 원본 복사
    let copyShortcut = { ctrl: true, shift: true, key: 'C' };
    chrome.storage.sync.get(['copyShortcut'], (result) => {
      if (result.copyShortcut) copyShortcut = result.copyShortcut;
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.copyShortcut) copyShortcut = changes.copyShortcut.newValue;
    });
    document.addEventListener('keydown', async (e) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      const keyCode = 'Key' + copyShortcut.key.toUpperCase();
      if (ctrlOrMeta === !!copyShortcut.ctrl &&
          e.shiftKey === !!copyShortcut.shift &&
          e.altKey === !!copyShortcut.alt &&
          e.code === keyCode) {
        e.preventDefault();
        if (originalText) {
          navigator.clipboard.writeText(originalText).then(() => {
            const btn = document.getElementById('yt-script-copy');
            if (btn) {
              btn.textContent = '복사됨!';
              setTimeout(() => btn.textContent = '복사', 1500);
            }
          });
        } else {
          await loadScript();
          if (originalText) {
            navigator.clipboard.writeText(originalText).then(() => {
              const btn = document.getElementById('yt-script-copy');
              if (btn) {
                btn.textContent = '복사됨!';
                setTimeout(() => btn.textContent = '복사', 1500);
              }
            });
          }
        }
      }
    });

    // YouTube SPA 네비게이션 감지 (yt-navigate-finish 이벤트 사용)
    window.addEventListener('yt-navigate-finish', () => {
      if (panel) panel.style.display = 'none';
      currentTranscript = [];
      originalText = '';
      translatedText = '';
      document.querySelectorAll('.yt-script-btn-container').forEach(el => el.remove());
      tryInsert();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
