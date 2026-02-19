const DEFAULT_PROMPT = `{text}

번역해줘.`;

const DEFAULT_SHORTCUT = { ctrl: true, shift: true, key: 'C' };

function shortcutToString(s) {
  const parts = [];
  if (s.ctrl) parts.push('Ctrl');
  if (s.shift) parts.push('Shift');
  if (s.alt) parts.push('Alt');
  parts.push(s.key);
  return parts.join('+');
}

// 저장된 설정 로드
chrome.storage.sync.get(['geminiApiKey', 'translatePrompt', 'copyShortcut', 'segmentMin'], (result) => {
  if (result.geminiApiKey) {
    document.getElementById('apiKey').value = result.geminiApiKey;
  }
  document.getElementById('prompt').value = result.translatePrompt || DEFAULT_PROMPT;
  document.getElementById('segmentMin').value = result.segmentMin || 30;

  const shortcut = result.copyShortcut || DEFAULT_SHORTCUT;
  document.getElementById('shortcutKey').value = shortcutToString(shortcut);
  document.getElementById('shortcutKey').dataset.shortcut = JSON.stringify(shortcut);
});

// 단축키 입력 캡처
document.getElementById('shortcutKey').addEventListener('keydown', (e) => {
  e.preventDefault();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

  const shortcut = {
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: e.key.length === 1 ? e.key.toUpperCase() : e.key
  };
  e.target.value = shortcutToString(shortcut);
  e.target.dataset.shortcut = JSON.stringify(shortcut);
});

// 저장 버튼
document.getElementById('save').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const prompt = document.getElementById('prompt').value.trim() || DEFAULT_PROMPT;
  const shortcutData = document.getElementById('shortcutKey').dataset.shortcut;
  const copyShortcut = shortcutData ? JSON.parse(shortcutData) : DEFAULT_SHORTCUT;
  const segmentMin = parseInt(document.getElementById('segmentMin').value) || 30;

  chrome.storage.sync.set({
    geminiApiKey: apiKey,
    translatePrompt: prompt,
    copyShortcut: copyShortcut,
    segmentMin: segmentMin
  }, () => {
    const status = document.getElementById('status');
    status.textContent = '저장되었습니다!';
    setTimeout(() => status.textContent = '', 2000);
  });
});
