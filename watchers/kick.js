import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const STREAMERS_PATH = path.join(DATA_DIR, 'streamers.json');
const STATE_PATH = path.join(DATA_DIR, 'stream_state.json');
const CFG_PATH = path.join(DATA_DIR, 'config.json');

function readJson(p, f) { try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return f; } }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STREAMERS_PATH)) writeJson(STREAMERS_PATH, []);
  if (!fs.existsSync(STATE_PATH)) writeJson(STATE_PATH, {});
  if (!fs.existsSync(CFG_PATH)) writeJson(CFG_PATH, { kick:{ message:'', allowedVoiceIds:[] } });
}

async function getKickInfo(login) {
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(login)}`);
  if (!res.ok) return { live:false };
  const data = await res.json();
  if (data?.livestream?.is_live) {
    return {
      live:true,
      id: data.livestream.id,
      title: data.livestream.session_title || '',
      game: data.livestream.game?.name || ''
    };
  }
  return { live:false };
}

const mins = (ms)=> Math.floor(ms/60000);

export function startKickWatcher(client) {
  ensure();
  const poll = Math.max(1, Number(process.env.STREAM_POLL_MIN || 3));
  console.log(`[Kick] watcher running every ${poll} minute(s)`);

  const run = async () => {
    const guildId = process.env.GUILD_ID;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const cfg = readJson(CFG_PATH, { kick:{ message:'', allowedVoiceIds:[] } });
    const allowed = Array.isArray(cfg.kick?.allowedVoiceIds)? cfg.kick.allowedVoiceIds : [];
    const template = (cfg.kick?.message || '').trim();

    const list = readJson(STREAMERS_PATH, []).filter(s=> s.enabled && s.platform==='kick' && s.login && s.discordUserId);
    if (!list.length) return;

    const state = readJson(STATE_PATH, {});
    const now = Date.now();
    const coolMin = 30;

    for (const s of list) {
      try {
        const key = `kick:${String(s.login).toLowerCase()}`;
        const info = await getKickInfo(s.login);
        const st = state[key] || { live:false, lastLiveId:null, lastNotifiedAt:0 };

        if (!info.live) {
          if (st.live) state[key] = { ...st, live:false, lastLiveId:null };
          continue;
        }

        state[key] = { ...st, live:true, lastLiveId: info.id };

        const member = await guild.members.fetch(s.discordUserId).catch(()=>null);
        const inVoice = !!member?.voice?.channelId && (allowed.length===0 || allowed.includes(member.voice.channelId));

        const since = mins(now - (st.lastNotifiedAt||0));
        const newStream = st.lastLiveId !== info.id;

        if (!inVoice && (newStream || since >= coolMin)) {
          const url = `https://kick.com/${s.login}`;
          const content = (template || `🔔 {user}, yayındasın ama seste değilsin. {url}`)
            .replaceAll('{user}', member ? `<@${member.id}>` : s.discordUserId)
            .replaceAll('{login}', s.login)
            .replaceAll('{url}', url)
            .replaceAll('{title}', info.title || '')
            .replaceAll('{game}', info.game || '');

          let delivered = false;
          try {
            const user = member?.user || await client.users.fetch(s.discordUserId);
            await user.send({ content });
            delivered = true;
          } catch {
            delivered = false;
          }
          if (!delivered && s.announceChannelId) {
            const ch = client.channels.cache.get(s.announceChannelId);
            if (ch) { await ch.send({ content: `*(DM kapalı: buraya gönderildi)*\n${content}` }); delivered = true; }
          }
          if (delivered) state[key].lastNotifiedAt = now;
        }
      } catch (e) {
        console.error('[Kick] error', s.login, e);
      }
    }
    writeJson(STATE_PATH, state);
  };

  run().catch(()=>{});
  setInterval(()=> run().catch(()=>{}), poll*60_000);
}
