import { useState, useEffect, useMemo } from "react";
import {
  CONTACT_STATUSES, CONTACT_STATUS_MAP, CAMPAIGN_TYPES, CAMPAIGN_TYPE_MAP, CAMPAIGN_STATUSES,
  AuthError, useApi, splitTags, audienceOf,
} from "./Mailing.jsx";

// Phone layout of the mailing screen: bottom tab bar, cards instead of tables,
// bottom sheets instead of dialogs. Same server actions as the desktop screen.
// Nothing here may touch the imports at module load (Mailing.jsx imports this file).

const C = {
  bg: "#f1f5f9", card: "#fff", ink: "#0f172a", sub: "#64748b", line: "#e2e8f0",
  brand: "#4f46e5", ok: "#10b981", warn: "#f59e0b", bad: "#ef4444",
};
const input = { width: "100%", padding: "12px 14px", border: "1.5px solid " + C.line, borderRadius: 12, fontSize: 16, color: C.ink, background: "#fff", boxSizing: "border-box", fontFamily: "inherit", outline: "none" };
const bigBtn = (bg = C.brand, fg = "#fff") => ({ padding: "13px 16px", background: bg, color: fg, border: "none", borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" });
const chip = on => ({ padding: "7px 13px", borderRadius: 20, border: "1.5px solid " + (on ? C.brand : C.line), background: on ? C.brand : "#fff", color: on ? "#fff" : C.sub, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", cursor: "pointer" });
const cardBox = { background: C.card, borderRadius: 16, padding: 14, boxShadow: "0 1px 4px #0000000f" };

function Pill({ color, children }) {
  return <span style={{ background: color + "1f", color, borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>{children}</span>;
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0006", zIndex: 300, display: "flex", alignItems: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxHeight: "92vh", overflowY: "auto", borderRadius: "20px 20px 0 0", padding: "10px 16px calc(18px + env(safe-area-inset-bottom))", direction: "rtl", boxSizing: "border-box" }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: "#cbd5e1", margin: "0 auto 10px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <b style={{ fontSize: 18, color: C.ink }}>{title}</b>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 28, color: "#94a3b8", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: C.sub, margin: "12px 0 6px" }}>{children}</div>;
}

export default function MailingMobile({ user, apiUrl, onAuthExpired, onReauth }) {
  const api = useApi(apiUrl, user);
  const [tab, setTab] = useState("home");
  const [state, setState] = useState({ contacts: [], campaigns: [], quota: null, sender: "" });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authLost, setAuthLost] = useState(false);
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState(null);
  const [contactFilter, setContactFilter] = useState("active");

  function handleErr(e) {
    if (e instanceof AuthError) setAuthLost(true);
    else setError(e.message || String(e));
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const d = await api("mail.state");
      setState({ contacts: d.contacts || [], campaigns: d.campaigns || [], quota: d.quota, sender: d.sender });
      setLoaded(true);
    } catch (e) {
      handleErr(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Refresh while a mailing is going out, and when the app comes back to the front.
  const sending = state.campaigns.some(c => c.status === "sending");
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && loaded) load(); };
    document.addEventListener("visibilitychange", onVis);
    const t = sending ? setInterval(load, 60000) : null;
    return () => { document.removeEventListener("visibilitychange", onVis); if (t) clearInterval(t); };
  }, [sending, loaded]);

  function notify(m) { setToast(m); setTimeout(() => setToast(""), 3000); }

  async function run(action, payload, okMsg) {
    try {
      const d = await api(action, payload);
      if (okMsg) notify(typeof okMsg === "function" ? okMsg(d) : okMsg);
      return d;
    } catch (e) {
      handleErr(e);
      return null;
    }
  }

  async function reauth() {
    if (!onReauth) return onAuthExpired();
    try {
      await onReauth();
      setAuthLost(false);
      load();
    } catch (e) {
      onAuthExpired();
    }
  }

  const counts = useMemo(() => {
    const c = Object.fromEntries(CONTACT_STATUSES.map(s => [s.id, 0]));
    state.contacts.forEach(x => { c[x.status] = (c[x.status] || 0) + 1; });
    return c;
  }, [state.contacts]);

  const allTags = useMemo(() => {
    const s = new Set();
    state.contacts.forEach(c => splitTags(c.tags).forEach(t => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "he"));
  }, [state.contacts]);

  const tabs = [
    { id: "home", icon: "🏠", label: "ראשי" },
    { id: "contacts", icon: "👥", label: "אנשי קשר", badge: counts.candidate || 0 },
    { id: "compose", icon: "✍️", label: "דיוור חדש" },
    { id: "history", icon: "📊", label: "דיוורים", badge: sending ? "•" : 0 },
  ];

  return (
    <div style={{ background: C.bg, minHeight: "calc(100vh - 60px)", paddingBottom: "calc(78px + env(safe-area-inset-bottom))", direction: "rtl" }}>
      {authLost && (
        <div style={{ margin: 12, padding: 14, background: "#fef2f2", border: "1.5px solid " + C.bad, borderRadius: 14 }}>
          <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>ההתחברות פגה (תוקף של שעה). צריך לאשר שוב.</div>
          <button onClick={reauth} style={bigBtn(C.bad)}>התחברות מחדש</button>
        </div>
      )}
      {error && (
        <div onClick={() => setError("")} style={{ margin: 12, padding: 12, background: "#fffbeb", border: "1.5px solid " + C.warn, borderRadius: 14, color: "#92400e", fontWeight: 600 }}>
          ⚠️ {error}
        </div>
      )}

      {!loaded ? (
        <div style={{ textAlign: "center", padding: 60, color: C.sub }}>{loading ? "⏳ טוען..." : authLost ? "" : "לא ניתן לטעון"}</div>
      ) : (
        <div style={{ padding: 12 }}>
          {tab === "home" && (
            <Home state={state} counts={counts} loading={loading} reload={load} run={run}
              go={t => setTab(t)} goContacts={f => { setContactFilter(f); setTab("contacts"); }} />
          )}
          {tab === "contacts" && (
            <Contacts contacts={state.contacts} counts={counts} allTags={allTags} filter={contactFilter} setFilter={setContactFilter} run={run} reload={load} />
          )}
          {tab === "compose" && (
            <Compose key={draft ? draft._key : "new"} initial={draft} contacts={state.contacts} allTags={allTags} quota={state.quota} user={user} run={run} reload={load}
              onQueued={() => { setDraft(null); setTab("history"); }} />
          )}
          {tab === "history" && (
            <History campaigns={state.campaigns} run={run} reload={load} loading={loading}
              onOpen={(c, copy) => { setDraft({ ...c, id: copy ? undefined : c.id, tags: splitTags(c.tags), _key: Date.now() }); setTab("compose"); }} />
          )}
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: "calc(90px + env(safe-area-inset-bottom))", left: 16, right: 16, background: C.ink, color: "#fff", padding: "13px 16px", borderRadius: 14, fontWeight: 700, textAlign: "center", zIndex: 400, boxShadow: "0 8px 24px #0004" }}>
          {toast}
        </div>
      )}

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid " + C.line, display: "flex", paddingBottom: "env(safe-area-inset-bottom)", zIndex: 200 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { if (t.id === "compose" && tab !== "compose") setDraft(null); setTab(t.id); }}
            style={{ flex: 1, background: "none", border: "none", padding: "9px 0 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: tab === t.id ? C.brand : C.sub, fontWeight: tab === t.id ? 800 : 600, fontSize: 11, position: "relative", cursor: "pointer" }}>
            <span style={{ fontSize: 21, filter: tab === t.id ? "none" : "grayscale(0.6)" }}>{t.icon}</span>
            {t.label}
            {!!t.badge && (
              t.badge === "•"
                ? <span style={{ position: "absolute", top: 7, left: "calc(50% - 16px)", background: C.ok, borderRadius: 5, width: 10, height: 10 }} />
                : <span style={{ position: "absolute", top: 4, left: "calc(50% - 22px)", background: C.warn, color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 800, minWidth: 16, height: 16, lineHeight: "16px", padding: "0 4px" }}>{t.badge}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ home

function Home({ state, counts, loading, reload, run, go, goContacts }) {
  const sendingNow = state.campaigns.filter(c => c.status === "sending");
  const recent = state.campaigns.filter(c => c.status !== "sending").slice(0, 3);
  const tiles = [
    { label: "אנשי קשר פעילים", value: counts.active || 0, color: C.ok, onClick: () => goContacts("active") },
    { label: "ממתינים לאישור", value: counts.candidate || 0, color: C.warn, onClick: () => goContacts("candidate") },
    { label: "מכסה שנותרה היום", value: state.quota ?? "-", color: C.brand },
    { label: "הסירו עצמם / חזרו", value: (counts.unsubscribed || 0) + (counts.bounced || 0), color: "#64748b", onClick: () => goContacts("unsubscribed") },
  ];
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {tiles.map(t => (
          <div key={t.label} onClick={t.onClick} style={{ ...cardBox, cursor: t.onClick ? "pointer" : "default" }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: t.color }}>{t.value}</div>
            <div style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>{t.label}</div>
          </div>
        ))}
      </div>

      {sendingNow.map(c => <CampaignCard key={c.id} c={c} run={run} reload={reload} />)}

      <button onClick={() => go("compose")} style={{ ...bigBtn(), marginBottom: 14 }}>✍️ דיוור חדש</button>

      {recent.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 2px 8px" }}>
            <b style={{ color: C.ink }}>דיוורים אחרונים</b>
            <span onClick={() => go("history")} style={{ color: C.brand, fontWeight: 700, fontSize: 13 }}>הכל ←</span>
          </div>
          {recent.map(c => <CampaignCard key={c.id} c={c} run={run} reload={reload} compact />)}
        </>
      )}

      <button onClick={reload} style={{ ...bigBtn("#fff", C.sub), border: "1.5px solid " + C.line, marginTop: 6 }}>{loading ? "⏳ מרענן..." : "↻ רענון"}</button>
      <div style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", marginTop: 10 }}>נשלח מ-{state.sender}</div>
    </>
  );
}

function CampaignCard({ c, run, reload, onOpen, compact }) {
  const st = CAMPAIGN_STATUSES[c.status] || { label: c.status, color: "#64748b" };
  const total = Number(c.total) || 0, sent = Number(c.sent) || 0, failed = Number(c.failed) || 0;
  const pct = total ? Math.round(((sent + failed) / total) * 100) : 0;
  return (
    <div style={{ ...cardBox, marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        <Pill color={st.color}>{st.label}</Pill>
        <span style={{ fontSize: 12, color: C.brand, fontWeight: 700 }}>{CAMPAIGN_TYPE_MAP[c.type]?.label || c.type}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", marginRight: "auto" }}>{String(c.createdAt || "").slice(0, 10)}</span>
      </div>
      <div style={{ fontWeight: 800, color: C.ink, fontSize: 15, marginBottom: 8 }}>{c.subject || "(ללא נושא)"}</div>
      {c.status !== "draft" && (
        <>
          <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
            <div style={{ width: pct + "%", height: "100%", background: st.color }} />
          </div>
          <div style={{ fontSize: 13, color: C.sub }}>
            נשלחו <b>{sent}</b> מתוך {total}{failed ? <span style={{ color: C.bad }}> · נכשלו {failed}</span> : null}
            {c.tags ? " · " + c.tags : " · כל הפעילים"}
          </div>
        </>
      )}
      {!compact && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {c.status === "sending" && (
            <button onClick={async () => { if (confirm("לעצור את השליחה? מי שכבר קיבל – קיבל.") && await run("mail.cancelCampaign", { id: c.id }, "השליחה נעצרה")) reload(); }}
              style={{ ...bigBtn("#fef2f2", C.bad), padding: 10, fontSize: 14 }}>⏹ עצירה</button>
          )}
          {c.status === "draft" && onOpen && <button onClick={() => onOpen(c, false)} style={{ ...bigBtn(), padding: 10, fontSize: 14 }}>✏️ המשך עריכה</button>}
          {c.status === "draft" && (
            <button onClick={async () => { if (confirm("למחוק את הטיוטה?") && await run("mail.deleteCampaign", { id: c.id }, "נמחק")) reload(); }}
              style={{ ...bigBtn("#fef2f2", C.bad), padding: 10, fontSize: 14, width: 56 }}>🗑</button>
          )}
          {c.status !== "draft" && c.status !== "sending" && onOpen && (
            <button onClick={() => onOpen(c, true)} style={{ ...bigBtn("#f1f5f9", C.ink), padding: 10, fontSize: 14 }}>⧉ שכפול לדיוור חדש</button>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ contacts

function Contacts({ contacts, counts, allTags, filter, setFilter, run, reload }) {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [limit, setLimit] = useState(50);
  const [edit, setEdit] = useState(null);
  useEffect(() => setLimit(50), [filter, search, tag]);

  const list = useMemo(() => {
    let l = contacts;
    if (filter !== "all") l = l.filter(c => c.status === filter);
    if (tag) l = l.filter(c => splitTags(c.tags).includes(tag));
    if (search) {
      const q = search.toLowerCase();
      l = l.filter(c => [c.email, c.name, c.company, c.tags].some(v => String(v || "").toLowerCase().includes(q)));
    }
    return [...l].sort((a, b) => (Number(b.seenCount) || 0) - (Number(a.seenCount) || 0) || String(a.company || "~").localeCompare(String(b.company || "~"), "he"));
  }, [contacts, filter, search, tag]);

  async function setStatus(c, status) {
    const d = await run("mail.saveContacts", { contacts: [{ email: c.email, status }] }, status === "active" ? "אושר לדיוור" : "סומן לא לדיוור");
    if (d) reload();
  }

  async function approveAllShown() {
    if (!confirm(`לאשר לדיוור את כל ${list.length} המוצגים?`)) return;
    const d = await run("mail.saveContacts", { contacts: list.map(c => ({ email: c.email, status: "active" })) }, x => `אושרו ${list.length}`);
    if (d) reload();
  }

  const filters = [{ id: "all", label: "הכל", n: contacts.length }, ...CONTACT_STATUSES.map(s => ({ id: s.id, label: s.label, n: counts[s.id] || 0 }))];

  return (
    <>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 חיפוש מייל, חברה, שם..." style={{ ...input, marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
        {filters.map(f => <button key={f.id} onClick={() => setFilter(f.id)} style={chip(filter === f.id)}>{f.label} {f.n}</button>)}
      </div>
      {allTags.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
          <button onClick={() => setTag("")} style={chip(!tag)}>כל התגיות</button>
          {allTags.map(t => <button key={t} onClick={() => setTag(tag === t ? "" : t)} style={chip(tag === t)}>{t}</button>)}
        </div>
      )}

      {filter === "candidate" && list.length > 0 && (
        <div style={{ ...cardBox, background: "#fffbeb", marginBottom: 10, fontSize: 13, color: "#92400e" }}>
          כתובות שעוד לא אושרו לדיוור. ✓ = אישור, ✕ = לא לדיוור.
          <button onClick={approveAllShown} style={{ ...bigBtn(C.ok), marginTop: 10, padding: 10, fontSize: 14 }}>✓ אישור כל {list.length} המוצגים</button>
        </div>
      )}

      <div style={{ fontSize: 12, color: C.sub, margin: "0 2px 8px" }}>{list.length} אנשי קשר</div>

      {list.slice(0, limit).map(c => {
        const st = CONTACT_STATUS_MAP[c.status] || { label: c.status, color: "#64748b" };
        return (
          <div key={c.email} style={{ ...cardBox, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <div onClick={() => setEdit(c)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
              <div style={{ fontWeight: 800, color: C.ink, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.company || c.name || c.email.split("@")[1]}</div>
              <div style={{ fontSize: 13, color: C.sub, direction: "ltr", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                {filter === "all" && <Pill color={st.color}>{st.label}</Pill>}
                {splitTags(c.tags).map(t => <Pill key={t} color={C.brand}>{t}</Pill>)}
              </div>
            </div>
            {c.status === "candidate" && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setStatus(c, "active")} style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: "#d1fae5", color: "#047857", fontSize: 20, fontWeight: 900 }}>✓</button>
                <button onClick={() => setStatus(c, "rejected")} style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: "#f1f5f9", color: C.sub, fontSize: 18, fontWeight: 900 }}>✕</button>
              </div>
            )}
          </div>
        );
      })}
      {list.length > limit && (
        <button onClick={() => setLimit(limit + 50)} style={{ ...bigBtn("#fff", C.sub), border: "1.5px solid " + C.line }}>הצגת עוד ({list.length - limit})</button>
      )}

      <button onClick={() => setEdit({})}
        style={{ position: "fixed", left: 18, bottom: "calc(86px + env(safe-area-inset-bottom))", width: 56, height: 56, borderRadius: 28, background: C.brand, color: "#fff", border: "none", fontSize: 30, boxShadow: "0 6px 18px #4f46e566", zIndex: 150 }}>+</button>

      {edit && <ContactSheet contact={edit.email ? edit : null} allTags={allTags} run={run} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function ContactSheet({ contact, allTags, run, onClose, onSaved }) {
  const [f, setF] = useState(contact ? { ...contact, tags: contact.tags || "" } : { email: "", name: "", company: "", tags: "", status: "active", notes: "" });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.email).trim());
  const tags = splitTags(f.tags);
  async function save() {
    const d = await run("mail.saveContacts", { contacts: [{ email: f.email.trim(), name: f.name || "", company: f.company || "", tags: f.tags, status: f.status, notes: f.notes || "" }] }, "נשמר");
    if (d) onSaved();
  }
  return (
    <Sheet title={contact ? "איש קשר" : "איש קשר חדש"} onClose={onClose}>
      <Label>מייל</Label>
      <input type="email" inputMode="email" autoCapitalize="none" value={f.email} onChange={set("email")} disabled={!!contact} style={{ ...input, direction: "ltr", background: contact ? "#f8fafc" : "#fff" }} />
      <Label>חברה</Label>
      <input value={f.company || ""} onChange={set("company")} style={input} />
      <Label>שם</Label>
      <input value={f.name || ""} onChange={set("name")} style={input} />
      <Label>סטטוס</Label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CONTACT_STATUSES.map(s => <button key={s.id} onClick={() => setF(x => ({ ...x, status: s.id }))} style={chip(f.status === s.id)}>{s.label}</button>)}
      </div>
      <Label>תגיות</Label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {allTags.map(t => (
          <button key={t} onClick={() => setF(x => ({ ...x, tags: (tags.includes(t) ? tags.filter(y => y !== t) : [...tags, t]).join(", ") }))} style={chip(tags.includes(t))}>{t}</button>
        ))}
      </div>
      <input value={f.tags} onChange={set("tags")} placeholder="או להקליד תגיות, מופרדות בפסיק" style={input} />
      <Label>הערות</Label>
      <textarea value={f.notes || ""} onChange={set("notes")} rows={3} style={{ ...input, resize: "vertical" }} />
      {contact && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>מקור: {contact.source || "-"} · נוסף: {String(contact.addedAt || "").slice(0, 10)}</div>}
      <button disabled={!valid} onClick={save} style={{ ...bigBtn(), marginTop: 16, opacity: valid ? 1 : 0.5 }}>שמירה</button>
    </Sheet>
  );
}

// ------------------------------------------------------------------ compose

function Compose({ initial, contacts, allTags, quota, user, run, reload, onQueued }) {
  const empty = { id: undefined, type: "marketing", isAd: true, subject: "", body: "", format: "text", tags: [] };
  const [c, setC] = useState(initial ? { ...empty, ...initial } : empty);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));

  const audience = useMemo(() => audienceOf(contacts, c.tags), [contacts, c.tags]);
  const tagCounts = useMemo(() => {
    const m = {};
    contacts.filter(x => x.status === "active").forEach(x => splitTags(x.tags).forEach(t => { m[t] = (m[t] || 0) + 1; }));
    return m;
  }, [contacts]);
  const ready = c.subject.trim() && c.body.trim();
  const payload = () => ({ ...c, tags: c.tags.join(", ") });

  async function save(silent) {
    setBusy("save");
    const d = await run("mail.saveCampaign", { campaign: payload() }, silent ? null : "הטיוטה נשמרה");
    setBusy("");
    if (d) { set("id", d.id); reload(); }
    return d;
  }
  async function showPreview() {
    setBusy("preview");
    const d = await run("mail.preview", { campaign: payload(), email: audience[0]?.email });
    setBusy("");
    if (d) setPreview(d);
  }
  async function testSend() {
    setBusy("test");
    await run("mail.testSend", { campaign: payload() }, d => `נשלח ניסיון ל-${d.to}`);
    setBusy("");
  }
  async function send() {
    const days = quota ? Math.ceil(audience.length / Math.max(quota, 1)) : 1;
    if (!confirm(`לשלוח את "${c.subject}" ל-${audience.length} נמענים?` + (audience.length > (quota || 0) ? `\nהמכסה היומית תפרוס את השליחה על כ-${days} ימים.` : "") + "\nהשליחה מתחילה בתוך כמה דקות.")) return;
    const saved = await save(true);
    if (!saved) return;
    setBusy("send");
    const d = await run("mail.queueCampaign", { id: saved.id }, x => `נכנס לתור: ${x.total} נמענים`);
    setBusy("");
    if (d) { reload(); onQueued(); }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {CAMPAIGN_TYPES.map(t => <button key={t.id} onClick={() => setC(x => ({ ...x, type: t.id, isAd: t.isAd }))} style={chip(c.type === t.id)}>{t.label}</button>)}
      </div>

      <Label>נושא</Label>
      <input value={c.subject} onChange={e => set("subject", e.target.value)} placeholder="לדוגמה: מחירי הובלה מטורקיה לדצמבר" style={input} />
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.sub, marginTop: 8 }}>
        <input type="checkbox" checked={c.isAd} onChange={e => set("isAd", e.target.checked)} style={{ width: 20, height: 20 }} />
        "פרסומת:" בתחילת הנושא (דיוור שיווקי)
      </label>

      <Label>תוכן</Label>
      <textarea value={c.body} onChange={e => set("body", e.target.value)} rows={12}
        placeholder={"שלום {{שם פרטי}},\n\n## כותרת\n\n- נקודה ראשונה\n- נקודה שנייה\n\nבברכה,\nיואב"}
        style={{ ...input, lineHeight: 1.55, resize: "vertical", fontFamily: c.format === "html" ? "monospace" : "inherit" }} />
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
        שורה ריקה = פסקה · ## כותרת · - תבליט · **מודגש** · {"{{שם פרטי}} {{חברה}}"}
      </div>

      <Label>למי לשלוח</Label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => set("tags", [])} style={chip(c.tags.length === 0)}>כל הפעילים</button>
        {allTags.map(t => {
          const on = c.tags.includes(t);
          return <button key={t} onClick={() => set("tags", on ? c.tags.filter(x => x !== t) : [...c.tags, t])} style={chip(on)}>{t} ({tagCounts[t] || 0})</button>;
        })}
      </div>
      <div style={{ ...cardBox, marginTop: 12, display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 900, color: C.ink }}>{audience.length}</span>
        <span style={{ fontSize: 13, color: C.sub }}>נמענים{quota !== null && audience.length > quota ? ` · יותר מהמכסה היומית (${quota})` : ""}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <button onClick={showPreview} disabled={!ready || !!busy} style={{ ...bigBtn("#e0e7ff", "#4338ca"), opacity: ready ? 1 : 0.5 }}>{busy === "preview" ? "⏳" : "👁 תצוגה"}</button>
        <button onClick={testSend} disabled={!ready || !!busy} style={{ ...bigBtn("#e0f2fe", "#0369a1"), opacity: ready ? 1 : 0.5 }}>{busy === "test" ? "⏳" : "🧪 ניסיון אליי"}</button>
      </div>
      <button onClick={() => save(false)} disabled={!!busy} style={{ ...bigBtn("#fff", C.sub), border: "1.5px solid " + C.line, marginTop: 8 }}>{busy === "save" ? "⏳ שומר..." : "💾 שמירת טיוטה"}</button>
      <button onClick={send} disabled={!ready || !audience.length || !!busy} style={{ ...bigBtn(C.ok), marginTop: 8, fontSize: 16, padding: 15, opacity: ready && audience.length ? 1 : 0.5 }}>
        {busy === "send" ? "⏳ מכניס לתור..." : `📤 שליחה ל-${audience.length} נמענים`}
      </button>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, textAlign: "center" }}>ניסיון נשלח ל-{user.email}</div>

      {preview && (
        <Sheet title="תצוגה מקדימה" onClose={() => setPreview(null)}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 8 }}>נושא: <b>{preview.subject}</b></div>
          <iframe title="preview" srcDoc={preview.html} sandbox="" style={{ width: "100%", height: "65vh", border: "1px solid " + C.line, borderRadius: 12 }} />
        </Sheet>
      )}
    </>
  );
}

// ------------------------------------------------------------------ history

function History({ campaigns, run, reload, loading, onOpen }) {
  if (!campaigns.length) return <div style={{ ...cardBox, textAlign: "center", color: C.sub, padding: 30 }}>עוד לא נשלחו דיוורים</div>;
  return (
    <>
      {campaigns.map(c => <CampaignCard key={c.id} c={c} run={run} reload={reload} onOpen={onOpen} />)}
      <button onClick={reload} style={{ ...bigBtn("#fff", C.sub), border: "1.5px solid " + C.line }}>{loading ? "⏳ מרענן..." : "↻ רענון"}</button>
    </>
  );
}
