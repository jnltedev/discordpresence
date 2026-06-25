const fs = require('fs');
const path = require('path');
const express = require('express');
const DiscordRPC = require('discord-rpc');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 3000);
const clientId = process.env.DISCORD_CLIENT_ID;
const autoRestore = String(process.env.AUTO_RESTORE ?? 'true').toLowerCase() !== 'false';
const reconnectIntervalMs = Math.max(1000, Number(process.env.RECONNECT_INTERVAL_MS || 1000));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const presenceFile = path.join(dataDir, 'last-presence.json');

let rpc = null;
let connected = false;
let lastPresence = null;
let lastError = null;
let connectingPromise = null;
let activitySetAfterConnect = false;
let reconnectTimerRunning = false;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() { fs.mkdirSync(dataDir, { recursive: true }); }

function loadPresenceFromDisk() {
  try {
    ensureDataDir();
    if (!fs.existsSync(presenceFile)) return null;
    const saved = JSON.parse(fs.readFileSync(presenceFile, 'utf8'));
    return saved && typeof saved === 'object' ? saved : null;
  } catch (error) {
    lastError = `Could not read saved presence: ${error.message}`;
    return null;
  }
}

function savePresenceToDisk(presence) {
  ensureDataDir();
  fs.writeFileSync(presenceFile, JSON.stringify(presence, null, 2));
}

function deletePresenceFromDisk() {
  try { if (fs.existsSync(presenceFile)) fs.unlinkSync(presenceFile); }
  catch (error) { lastError = `Could not delete saved presence: ${error.message}`; }
}

function discordIpcSocketExists() {
  const dirs = [process.env.XDG_RUNTIME_DIR, '/tmp'].filter(Boolean);
  for (const dir of dirs) {
    try {
      const entries = fs.readdirSync(dir);
      if (entries.some((name) => /^discord-ipc-\d+$/.test(name))) return true;
    } catch {
      // Ignore inaccessible runtime directories. discord-rpc will still try its
      // own lookup when we attempt a connection.
    }
  }
  return false;
}

function cleanString(value, max = 128) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function cleanUrl(value) {
  const text = cleanString(value, 512);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch { return undefined; }
}

function cleanActivityType(value) {
  const type = Number(value);
  return new Set([0, 2, 3, 5]).has(type) ? type : 0;
}

function buildButtons(body) {
  const candidates = [
    { label: cleanString(body.button1Label ?? body.buttonLabel, 32), url: cleanUrl(body.button1Url ?? body.buttonUrl) },
    { label: cleanString(body.button2Label, 32), url: cleanUrl(body.button2Url) }
  ];
  const incomplete = candidates.find((button) => (button.label && !button.url) || (!button.label && button.url));
  if (incomplete) throw new Error('Each button needs both a label and a valid http/https URL.');
  return candidates.filter((button) => button.label && button.url).slice(0, 2);
}

function buildPresence(body) {
  const displayName = cleanString(body.displayName, 128);
  const details = cleanString(body.details);
  const state = cleanString(body.state);
  if (!details && !state) throw new Error('Please fill in at least Details or State.');

  const activity = { name: displayName, type: cleanActivityType(body.activityType), details, state, instance: false };
  const largeImageKey = cleanString(body.largeImageKey, 64);
  const largeImageText = cleanString(body.largeImageText);
  const smallImageKey = cleanString(body.smallImageKey, 64);
  const smallImageText = cleanString(body.smallImageText);

  if (largeImageKey || largeImageText || smallImageKey || smallImageText) {
    activity.assets = {};
    if (largeImageKey) activity.assets.large_image = largeImageKey;
    if (largeImageText) activity.assets.large_text = largeImageText;
    if (smallImageKey) activity.assets.small_image = smallImageKey;
    if (smallImageText) activity.assets.small_text = smallImageText;
  }
  if (body.showTimestamp) activity.timestamps = { start: Math.floor(Date.now() / 1000) };
  const buttons = buildButtons(body);
  if (buttons.length) activity.buttons = buttons;

  Object.keys(activity).forEach((key) => activity[key] === undefined && delete activity[key]);
  if (activity.assets && !Object.keys(activity.assets).length) delete activity.assets;
  return activity;
}

function safeCloseRpc(client) {
  if (!client) return;
  try { client.removeAllListeners(); } catch {}

  // discord-rpc can crash when destroy()/transport.close() is called after the
  // IPC socket already became null. We therefore close the raw socket directly
  // and intentionally avoid client.destroy(). A new client is created on the
  // next reconnect tick.
  try {
    const socket = client.transport?.socket;
    if (socket && !socket.destroyed) socket.destroy();
  } catch {}

  try { client.transport = null; } catch {}
}

function resetRpc(reason) {
  connected = false;
  activitySetAfterConnect = false;
  if (reason) lastError = reason;
  const oldRpc = rpc;
  rpc = null;
  safeCloseRpc(oldRpc);
}

async function sendPresence(presence) {
  if (!rpc || !connected) throw new Error('Discord RPC is not connected.');
  await rpc.request('SET_ACTIVITY', { pid: process.pid, activity: presence });
  activitySetAfterConnect = true;
}

async function connectRpc({ force = false } = {}) {
  if (!clientId) throw new Error('DISCORD_CLIENT_ID is missing in .env');
  if (connected && rpc && !force) return rpc;
  if (connectingPromise && !force) return connectingPromise;

  if (force || rpc) resetRpc();
  const client = new DiscordRPC.Client({ transport: 'ipc' });
  rpc = client;
  DiscordRPC.register(clientId);

  client.on('ready', () => {
    if (rpc !== client) return;
    connected = true;
    lastError = null;
  });

  const markDisconnected = (error) => {
    if (rpc !== client) return;
    resetRpc(error?.message || 'Discord RPC disconnected. Waiting for Discord...');
  };
  client.on('disconnected', markDisconnected);
  client.on('close', markDisconnected);
  client.on('error', markDisconnected);

  connectingPromise = client.login({ clientId })
    .then(() => {
      if (rpc !== client) return rpc;
      connected = true;
      lastError = null;
      return client;
    })
    .catch((error) => {
      if (rpc === client) resetRpc(error.message || 'Could not connect to Discord.');
      throw error;
    })
    .finally(() => { connectingPromise = null; });

  return connectingPromise;
}

async function restoreSavedPresence(reason = 'restore', force = false) {
  if (!autoRestore || !lastPresence) return;
  try {
    // Fast path: if we are already connected, do not reconnect. Just apply the
    // latest saved activity immediately.
    if (connected && rpc && !force) {
      await sendPresence(lastPresence);
      console.log(`Applied saved Discord Rich Presence (${reason}).`);
      return;
    }

    // Avoid long discord-rpc login attempts while the IPC socket is not visible
    // in Docker yet. As soon as Discord creates discord-ipc-* in the mounted
    // runtime dir, the next 1s tick connects immediately.
    if (!force && !discordIpcSocketExists()) {
      lastError = 'Discord IPC socket not visible yet. Waiting for Discord...';
      return;
    }

    await connectRpc({ force });
    if (connected) {
      await sendPresence(lastPresence);
      console.log(`Restored saved Discord Rich Presence (${reason}).`);
    }
  } catch (error) {
    lastError = error.message;
  }
}

async function backgroundTick() {
  if (!autoRestore || !lastPresence || connectingPromise) return;
  if (!connected || !rpc) {
    await restoreSavedPresence('waiting for Discord');
    return;
  }

  // Important: do not force-reconnect on a timer. discord-rpc keeps the IPC
  // connection alive internally. We only resend once after a fresh connection
  // if the activity has not been applied yet. Reconnect is handled exclusively
  // by the close/disconnected/error events above.
  if (!activitySetAfterConnect) {
    await restoreSavedPresence('apply after connect');
  }
}

app.get('/api/status', (_req, res) => {
  res.json({ configured: Boolean(clientId), connected, autoRestore, hasSavedPresence: Boolean(lastPresence), lastPresence, lastError });
});

app.get("/api/config", (req, res) => {
  res.json({
    clientId: process.env.DISCORD_CLIENT_ID || ""
  });
});

const packageJson = require("../package.json");
app.get("/api/about", (req, res) => {
  res.json({
    version: packageJson.version,
    author: packageJson.author,
    website: packageJson.homepage,
    github: packageJson.repository.url.replace("git+", "").replace(".git", "")
  });
});

app.get('/api/saved-presence', (_req, res) => res.json({ ok: true, presence: lastPresence }));

app.post('/api/connect', async (_req, res) => {
  try {
    await restoreSavedPresence('manual connect', true);
    res.json({ ok: true, connected, restored: Boolean(lastPresence) });
  } catch (error) {
    lastError = error.message;
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/presence', async (req, res) => {
  try {
    const presence = buildPresence(req.body);
    lastPresence = presence;
    savePresenceToDisk(presence);

    // Saving should not tear down a healthy RPC connection. If Discord is
    // already connected, update the activity in-place. If not, attempt one
    // immediate connect/apply and let the background loop keep trying.
    if (connected && rpc) {
      await sendPresence(presence);
    } else {
      activitySetAfterConnect = false;
      await restoreSavedPresence('manual save');
    }

    res.json({ ok: true, presence, connected });
  } catch (error) {
    lastError = error.message;
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete('/api/presence', async (_req, res) => {
  try {
    if (connected && rpc) {
      try { await rpc.request('SET_ACTIVITY', { pid: process.pid }); } catch {}
    }
    lastPresence = null;
    deletePresenceFromDisk();
    resetRpc();
    res.json({ ok: true });
  } catch (error) {
    lastError = error.message;
    res.status(500).json({ ok: false, error: error.message });
  }
});

lastPresence = loadPresenceFromDisk();

app.listen(port, '0.0.0.0', () => {
  console.log(`Discord Rich Presence Control Panel is running on port ${port}`);
  console.log(`Open in your browser only when you want to change settings: http://localhost:${port}`);
  console.log(`Discord IPC lookup path uses XDG_RUNTIME_DIR=${process.env.XDG_RUNTIME_DIR || '/tmp'}`);
  if (autoRestore && lastPresence) console.log('Saved presence found. Waiting for Discord to start...');
});

async function guardedBackgroundTick() {
  if (reconnectTimerRunning) return;
  reconnectTimerRunning = true;
  try {
    await backgroundTick();
  } catch (error) {
    lastError = error.message || String(error);
    console.error('Background reconnect failed:', lastError);
  } finally {
    reconnectTimerRunning = false;
  }
}

process.on('unhandledRejection', (error) => {
  lastError = error?.message || String(error);
  console.error('Unhandled rejection:', lastError);
});

process.on('uncaughtException', (error) => {
  lastError = error?.message || String(error);
  console.error('Uncaught exception:', lastError);
});

setInterval(guardedBackgroundTick, reconnectIntervalMs);
setImmediate(() => guardedBackgroundTick());
