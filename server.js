const express = require("express"), fs = require("fs"), path = require("path");
const app = express();
app.use(express.json({ limit: "2kb" }));
const SHOW_CODE = (process.env.SHOW_CODE || "EXPLORE").trim().toUpperCase();
const HELPER_KEY = process.env.HELPER_KEY || "";
const START = Number(process.env.START_CREDITS) || 10;
const COOLDOWN = 10, PHONE_GAP = 3000, MAX_QUEUE = 40;
let ACTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, "actions.json"), "utf8"));
if (process.env.HIDE_TEST) ACTIONS = ACTIONS.filter(a => a.tab !== "test");
const clients = new Map(), queue = [];
let killed = false;

function getClient(id) {
  if (typeof id !== "string" || id.length < 8 || id.length > 64) return null;
  if (!clients.has(id)) clients.set(id, { credits: START, last: {}, lastAny: 0 });
  return clients.get(id);
}
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const codeOk = c => String(c || "").trim().toUpperCase() === SHOW_CODE;

app.post("/api/join", (req, res) => {
  const c = getClient(req.body.clientId);
  if (!c || !codeOk(req.body.code)) return res.json({ ok: false });
  res.json({ ok: true, credits: c.credits, actions: ACTIONS });
});

app.post("/api/press", (req, res) => {
  const c = getClient(req.body.clientId);
  if (!c || !codeOk(req.body.code)) return res.json({ ok: false, error: "Session expired. Reload the page." });
  if (killed) return res.json({ ok: false, error: "The panel is paused right now.", credits: c.credits });
  const a = ACTIONS.find(x => x.name === req.body.action);
  if (!a) return res.json({ ok: false, error: "Unknown action.", credits: c.credits });
  const now = Date.now();
  if (now - c.lastAny < PHONE_GAP) return res.json({ ok: false, error: "Hold on a moment.", credits: c.credits });
  if (c.last[a.name] && now - c.last[a.name] < COOLDOWN * 1000) return res.json({ ok: false, error: a.name + " is cooling down.", credits: c.credits });
  if (c.credits < a.cost) return res.json({ ok: false, error: "You are out of credits.", credits: c.credits });
  if (queue.length >= MAX_QUEUE) return res.json({ ok: false, error: "The stream is busy. Try again in a moment.", credits: c.credits });
  const f = a.fields || [];
  const username = clean(req.body.username, 25), message = clean(req.body.message, 200);
  if ((f.includes("username") && !username) || (f.includes("message") && !message))
    return res.json({ ok: false, error: "Please fill in everything.", credits: c.credits });
  c.credits -= a.cost; c.lastAny = now; c.last[a.name] = now;
  queue.push({ action: a.name, username: f.includes("username") ? username : "", message: f.includes("message") ? message : "", at: now });
  res.json({ ok: true, credits: c.credits, cooldown: COOLDOWN });
});

function isHelper(req) { return HELPER_KEY && req.query.key === HELPER_KEY; }

app.get("/api/next", (req, res) => {
  if (!isHelper(req)) return res.status(401).json({});
  if (killed) return res.json({});
  const item = queue.shift();
  res.json(item || {});
});

// Kill switch: /api/kill?key=YOURKEY&on=1 pauses the panel, on=0 resumes it.
app.get("/api/kill", (req, res) => {
  if (!isHelper(req)) return res.status(401).send("No");
  killed = req.query.on === "1";
  if (killed) queue.length = 0;
  res.send(killed ? "Panel PAUSED" : "Panel RUNNING");
});

app.use(express.static(path.join(__dirname, "public")));
app.listen(process.env.PORT || 3000, () => console.log("Relay running"));
