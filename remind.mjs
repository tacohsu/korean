/* 韓文學習提醒：讀 Supabase 進度，用 LINE Messaging API 推播
   由 .github/workflows/remind.yml 定時執行 */

const {
  SUPABASE_URL, SUPABASE_ANON_KEY, SYNC_CODE,
  LINE_TOKEN, LINE_USER_ID,
  APP_URL = "", TRIP_DATE = "2026-11-07",
} = process.env;

const need = { SUPABASE_URL, SUPABASE_ANON_KEY, SYNC_CODE, LINE_TOKEN, LINE_USER_ID };
for (const [k, v] of Object.entries(need)) {
  if (!v) { console.error(`缺少環境變數 ${k}`); process.exit(1); }
}

/* ---- 日期：必須和 app 算出同一個編號，否則會早一天判定到期 ----
   app 跑在台灣手機上，dnum("2026-09-14") 是用當地午夜換算的，
   這台機器跑在 UTC，所以要自己減掉 8 小時時差。 */
const TZ = "Asia/Taipei", TZ_OFFSET_H = 8;
const today = () => new Date().toLocaleDateString("sv", { timeZone: TZ });
const dnum = s =>
  Math.floor((Date.parse(s + "T00:00:00Z") - TZ_OFFSET_H * 3600e3) / 864e5);

/* ---- 讀取進度 ---- */
async function pull() {
  const r = await fetch(
    SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/jp_pull",
    { method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY,
                 Authorization: "Bearer " + SUPABASE_ANON_KEY,
                 "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: SYNC_CODE + "-kr" }) });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  const rows = await r.json();
  return (rows && rows[0] && rows[0].data) || null;
}

/* ---- 換算今天的進度（規則和 app 內一致） ---- */
function summarize(S) {
  const t = today(), tn = dnum(t);
  const day = S.day && S.day.d === t ? S.day : { newN: 0, revN: 0, lrnN: 0 };
  const done = (day.newN || 0) + (day.revN || 0) + (day.lrnN || 0);

  let dueRev = 0, dueLearn = 0;
  for (const c of Object.values(S.cards || {})) {
    if (tn >= c.due) (c.ivl > 0 ? dueRev++ : dueLearn++);
  }
  const cap = S.revPerDay > 0 ? S.revPerDay : Infinity;
  const revLeft = Math.max(0, cap - (day.revN || 0));
  const backlog = Math.max(0, dueRev - revLeft);
  const paused = S.pauseNew !== false && backlog > 0;
  const newLeft = paused ? 0 : Math.max(0, (S.newPerDay || 16) - (day.newN || 0));

  const left = dueLearn + Math.min(dueRev, revLeft) + newLeft;
  const learned = Object.keys(S.cards || {}).length;
  const mastered = Object.values(S.cards || {}).filter(c => c.ivl >= 21).length;
  return { done, left, newLeft, backlog, paused, learned, mastered,
           streak: S.streak || 0, lastDay: S.last || "" };
}

/* ---- 組訊息 ---- */
function compose(s) {
  const days = Math.ceil((dnum(TRIP_DATE) - dnum(today())));
  const trip = days > 0 ? `　離釜山還有 ${days} 天` : "";
  const link = APP_URL ? `\n${APP_URL}` : "";

  if (!s) return `今天的韓文還沒開始。${trip}${link}`;

  if (s.left === 0)
    return `今天的 ${s.done} 張都做完了，辛苦了。` +
      `\n累計學過 ${s.learned} 張，已熟練 ${s.mastered} 張${trip}`;

  const head = s.done > 0
    ? `今天做了 ${s.done} 張，還剩 ${s.left} 張。`
    : `今天的韓文還沒開始，有 ${s.left} 張等著。`;
  const note = s.paused
    ? `\n複習積了 ${s.backlog} 張超過上限，今天先不加新卡。`
    : (s.newLeft > 0 ? `\n其中 ${s.newLeft} 張是新內容。` : "");
  const streak = s.streak > 1 ? `\n目前連續 ${s.streak} 天` : "";
  return head + note + streak + trip + link;
}

/* ---- 推播 ---- */
async function push(text) {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: "Bearer " + LINE_TOKEN,
               "Content-Type": "application/json" },
    body: JSON.stringify({ to: LINE_USER_ID, messages: [{ type: "text", text }] }),
  });
  if (!r.ok) throw new Error(`LINE HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

/* ---- 主流程：讀不到進度時仍然提醒，只是不帶數字 ---- */
let state = null;
try { state = await pull(); }
catch (e) { console.error("讀取進度失敗，改送簡單提醒：" + e.message); }

const summary = state ? summarize(state) : null;

/* 全部做完就不打擾；想每天都收到，把下面三行刪掉 */
if (summary && summary.left === 0 && process.env.QUIET_WHEN_DONE !== "0") {
  console.log("今天已完成，不推播"); process.exit(0);
}

const text = compose(summary);
await push(text);
console.log("已推播：\n" + text);
