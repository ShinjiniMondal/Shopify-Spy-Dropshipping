// options.js

document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('hf-token');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('status');

  // Load existing token
  chrome.storage.local.get(['hf_token'], (res) => {
    if (res.hf_token) {
      tokenInput.value = res.hf_token;
    }
  });

  // Save token
  saveBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    
    if (!token) {
      statusEl.textContent = 'Token cannot be empty';
      statusEl.style.color = '#ef4444';
      return;
    }

    chrome.storage.local.set({ hf_token: token }, () => {
      statusEl.textContent = 'Saved ✓';
      statusEl.className = 'status-success';
      
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = '';
      }, 2000);
    });
  });
});
