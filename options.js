const DEFAULT_PROMPT = `{text}

번역해줘.`;

// 저장된 설정 로드
chrome.storage.sync.get(['geminiApiKey', 'translatePrompt'], (result) => {
  if (result.geminiApiKey) {
    document.getElementById('apiKey').value = result.geminiApiKey;
  }
  document.getElementById('prompt').value = result.translatePrompt || DEFAULT_PROMPT;
});

// 저장 버튼
document.getElementById('save').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const prompt = document.getElementById('prompt').value.trim() || DEFAULT_PROMPT;

  chrome.storage.sync.set({
    geminiApiKey: apiKey,
    translatePrompt: prompt
  }, () => {
    const status = document.getElementById('status');
    status.textContent = '저장되었습니다!';
    setTimeout(() => status.textContent = '', 2000);
  });
});
