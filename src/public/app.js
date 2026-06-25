const form = document.querySelector('#presenceForm');
const statusEl = document.querySelector('#status');
const messageEl = document.querySelector('#message');
const clearBtn = document.querySelector('#clearBtn');
const previewType = document.querySelector('#previewType');
const previewDetails = document.querySelector('#previewDetails');
const previewState = document.querySelector('#previewState');
const previewButtons = document.querySelector('#previewButtons');

// v10: The server JSON file is the single source of truth.
// Old browser data from v4-v9 is removed so it can no longer overwrite
// ./data/last-presence.json or display stale values in the form.
const OLD_STORAGE_KEYS = [
  'discord-rich-presence-form',
  'discord-rich-presence-form-v2'
];

const activityNames = {
  0: 'Playing',
  2: 'Listening to',
  3: 'Watching',
  5: 'Competing in'
};

fetch("/api/config")
  .then((res) => res.json())
  .then((config) => {
    const link = document.getElementById("assetsLink");

  if (config.clientId) {
    link.href = `https://discord.com/developers/applications/${config.clientId}/rich-presence/assets`;
  }
});

fetch("/api/about")
    .then(res => res.json())
    .then(about => {
        document.getElementById("footer").innerHTML = `
            <div class="footer-content">
                <span class="footer-version">v${about.version}</span>

                <span class="footer-divider">•</span>

                <span class="footer-author">
                    Developed by
                    <a href="${about.website}" target="_blank" rel="noopener noreferrer">
                        ${about.author}
                    </a>
                </span>

                <a href="${about.github}"
                   class="footer-icon"
                   target="_blank"
                   rel="noopener noreferrer"
                   aria-label="GitHub">

                    <svg viewBox="0 0 16 16">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                        0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                        -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87
                        2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
                        0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12
                        0 0 .67-.21 2.2.82a7.63 7.63 0 0 1 4 0c1.53-1.04 2.2-.82
                        2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15
                        0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
                        0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013
                        8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                    </svg>

                </a>
            </div>
        `;
    });

function removeOldLocalStorage() {
  try {
    OLD_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
  }
}

function setMessage(text, type = '') {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}

function serializeForm() {
  const data = new FormData(form);
  return {
    activityType: Number(data.get('activityType') || 0),
    displayName: data.get('displayName') || '',
    details: data.get('details') || '',
    state: data.get('state') || '',
    largeImageKey: data.get('largeImageKey') || '',
    largeImageText: data.get('largeImageText') || '',
    smallImageKey: data.get('smallImageKey') || '',
    smallImageText: data.get('smallImageText') || '',
    button1Label: data.get('button1Label') || '',
    button1Url: data.get('button1Url') || '',
    button2Label: data.get('button2Label') || '',
    button2Url: data.get('button2Url') || '',
    showTimestamp: data.get('showTimestamp') === 'on'
  };
}

function normalizePresenceToForm(data) {
  if (!data || typeof data !== 'object') return null;

  // Saved server format: Discord RPC activity object.
  if ('details' in data || 'state' in data || 'assets' in data || 'buttons' in data || 'timestamps' in data) {
    return {
      activityType: Number(data.type ?? 0),
      displayName: data.name || '',
      details: data.details || '',
      state: data.state || '',
      largeImageKey: data.assets?.large_image || '',
      largeImageText: data.assets?.large_text || '',
      smallImageKey: data.assets?.small_image || '',
      smallImageText: data.assets?.small_text || '',
      button1Label: data.buttons?.[0]?.label || '',
      button1Url: data.buttons?.[0]?.url || '',
      button2Label: data.buttons?.[1]?.label || '',
      button2Url: data.buttons?.[1]?.url || '',
      showTimestamp: Boolean(data.timestamps?.start)
    };
  }

  // Form format fallback for very old saved files.
  return data;
}

function applyFormData(data) {
  const normalized = normalizePresenceToForm(data);
  form.reset();

  if (!normalized || typeof normalized !== 'object') {
    updatePreview();
    return;
  }

  Object.entries(normalized).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;

    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
      return;
    }

    field.value = value ?? '';
  });

  updatePreview();
}

function clearForm() {
  form.reset();
  updatePreview();
}


function updatePreview() {
  const data = serializeForm();
  const verb = activityNames[data.activityType] || 'Playing';
  previewType.textContent = data.displayName.trim() ? `${verb} ${data.displayName.trim()}` : verb;
  previewDetails.textContent = data.details.trim() || 'Details';
  previewState.textContent = data.state.trim() || 'State';

  const labels = [data.button1Label, data.button2Label].map((value) => value.trim()).filter(Boolean);
  previewButtons.innerHTML = '';
  if (!labels.length) {
    const span = document.createElement('span');
    span.textContent = 'Optional button';
    previewButtons.appendChild(span);
    return;
  }

  labels.slice(0, 2).forEach((label) => {
    const span = document.createElement('span');
    span.textContent = label;
    previewButtons.appendChild(span);
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.error || 'Unknown error');
  }
  return json;
}

async function loadFromServer() {
  try {
    const data = await api('/api/saved-presence');
    if (data.presence) {
      applyFormData(data.presence);
      setMessage('Loaded saved presence from server file.', 'ok');
    } else {
      clearForm();
      setMessage('No saved presence found on server.', '');
    }
  } catch {
    setMessage('Could not load saved presence from server.', 'error');
  }
}

async function refreshStatus() {
  try {
    const data = await api('/api/status');
    statusEl.className = `status ${data.connected ? 'ok' : data.hasSavedPresence ? 'idle' : ''}`;
    if (!data.configured) {
      statusEl.textContent = 'Missing Client ID';
    } else if (data.connected) {
      statusEl.textContent = data.hasSavedPresence ? 'Running in background · Discord connected' : 'Connected to Discord';
    } else if (data.hasSavedPresence) {
      statusEl.textContent = 'Background service active · waiting for Discord';
    } else {
      statusEl.textContent = 'Not connected';
    }
  } catch {
    statusEl.className = 'status error';
    statusEl.textContent = 'Status unavailable';
  }
}

form.addEventListener('input', updatePreview);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('Saving presence to server file and sending to Discord...');
  try {
    const result = await api('/api/presence', {
      method: 'POST',
      body: JSON.stringify(serializeForm())
    });
    applyFormData(result.presence);
    setMessage('Presence saved on server. You can close this browser tab now; the background service will restore it when Discord starts.', 'ok');
    await refreshStatus();
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  }
});

clearBtn.addEventListener('click', async () => {
  setMessage('Clearing Discord presence and server file...');
  try {
    await api('/api/presence', { method: 'DELETE' });
    clearForm();
    removeOldLocalStorage();
    setMessage('Presence and saved server file cleared.', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    await refreshStatus();
  }
});

removeOldLocalStorage();
updatePreview();
loadFromServer();
refreshStatus();
setInterval(refreshStatus, 5000);
