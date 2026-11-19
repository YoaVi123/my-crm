import { useState, useEffect, useMemo, useRef } from "react";
import MailingMobile from "./MailingMobile.jsx";

// Mailing screen: contacts list, new mailing, history.
// Talks to the same Apps Script web app as the quotes screen (Mailing.gs),
// sending the Google sign-in token so the script can check who is asking.

export const CONTACT_STATUSES = [
  { id: "active", label: "פעיל", color: "#10b981" },
  { id: "candidate", label: "ממתין לאישור", color: "#f59e0b" },
  { id: "unsubscribed", label: "הסיר עצמו", color: "#64748b" },
  { id: "bounced", label: "כתובת שגויה", color: "#ef4444" },
  { id: "rejected", label: "לא לדיוור", color: "#94a3b8" },
];
export const CONTACT_STATUS_MAP = Object.fromEntries(CONTACT_STATUSES.map(s => [s.id, s]));

export const CAMPAIGN_TYPES = [
  { id: "marketing", label: "שיווק וקמפיין", isAd: true },
  { id: "prices", label: "עדכון מחירים", isAd: true },
  { id: "operational", label: "עדכון תפעולי", isAd: false },
];
export const CAMPAIGN_TYPE_MAP = Object.fromEntries(CAMPAIGN_TYPES.map(t => [t.id, t]));

export const CAMPAIGN_STATUSES = {
  draft: { label: "טיוטה", color: "#64748b" },
  sending: { label: "בשליחה", color: "#3b82f6" },
  done: { label: "נשלח", color: "#10b981" },
  cancelled: { label: "בוטל", color: "#ef4444" },
};

const inputStyle = { width: "100%", padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, color: "#0f172a", outline: "none", background: "#f8fafc", boxSizing: "border-box", fontFamily: "inherit" };
const btn = (bg = "#6366f1", fg = "#fff") => ({ padding: "9px 16px", background: bg, color: fg, border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" });
const card = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 6px #0001", padding: 20 };

export class AuthError extends Error {}

function tokenExpired(idToken) {
  try {
    const p = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return !p.exp || p.exp * 1000 < Date.now() + 30000;
  } catch (e) {
    return true;
  }
}

export function useApi(apiUrl, user) {
  return async function api(action, payload = {}) {
    if (!user.idToken || tokenExpired(user.idToken)) throw new AuthError();
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, idToken: user.idToken, ...payload }),
    });
    const data = await r.json();
    if (data.status === "auth") throw new AuthError();
    if (data.status !== "ok") throw new Error(data.error || "שגיאה");
    return data;
  };
}

export function splitTags(t) {
  return String(t || "").split(/[,،;]/).map(x => x.trim()).filter(Boolean);
}

export function audienceOf(contacts, tags) {
  const want = tags || [];
  const seen = new Set();
  return contacts.filter(c => {
    const e = (c.email || "").toLowerCase();
    if (!e || seen.has(e) || c.status !== "active") return false;
    if (want.length && !splitTags(c.tags).some(t => want.includes(t))) return false;
    seen.add(e);
    return true;
  });
}

function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000066", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width, maxWidth: "95vw", boxShadow: "0 20px 60px #0003", direction: "rtl", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function Pill({ color, children }) {
  return <span style={{ background: color + "1f", color, border: "1.5px solid " + color + "44", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
}

// ------------------------------------------------------------------ main

// Phones get their own layout (MailingMobile.jsx); same server, same data.
export function useIsMobile(max = 760) {
  const q = "(max-width: " + max + "px)";
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, [q]);
  return m;
}

export default function Mailing(props) {
  const mobile = useIsMobile();
  return mobile ? <MailingMobile {...props} /> : <MailingDesktop {...props} />;
}

function MailingDesktop({ user, apiUrl, onAuthExpired, onReauth, clientNames = [] }) {
  const api = useApi(apiUrl, user);
  const [tab, setTab] = useState("contacts");
  const [state, setState] = useState({ contacts: [], campaigns: [], quota: null, sender: "" });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [authLost, setAuthLost] = useState(false);
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState(null);

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

  function notify(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

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
    { id: "contacts", label: `👥 אנשי קשר (${state.contacts.length})` },
    { id: "compose", label: "✍️ דיוור חדש" },
    { id: "history", label: `📊 היסטוריה (${state.campaigns.length})` },
  ];

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
      {authLost && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #ef4444", borderRadius: 10, padding: "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#b91c1c", fontWeight: 600 }}>ההתחברות פגה (תוקף של שעה) או שאין לך הרשאה לדיוור. יש להתחבר מחדש.</span>
          <button onClick={() => (onReauth ? onReauth().then(() => { setAuthLost(false); load(); }).catch(onAuthExpired) : onAuthExpired())} style={btn("#ef4444")}>התחברות מחדש</button>
        </div>
      )}
      {error && (
        <div style={{ background: "#fffbeb", border: "1.5px solid #f59e0b", borderRadius: 10, padding: "12px 18px", marginBottom: 16, color: "#92400e", fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
          <span>⚠️ {error}</span>
          <span onClick={() => setError("")} style={{ cursor: "pointer" }}>×</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...btn(tab === t.id ? "#0f172a" : "#fff", tab === t.id ? "#fff" : "#475569"), border: "1.5px solid #e2e8f0", padding: "9px 18px", fontSize: 14 }}>
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {state.quota !== null && (
          <span style={{ fontSize: 12, color: "#64748b" }}>
            נשלח מ-{state.sender} · מכסה שנותרה היום: <b>{state.quota}</b>
          </span>
        )}
        <button onClick={load} style={btn("#f1f5f9", "#475569")}>{loading ? "טוען..." : "↻ רענון"}</button>
      </div>

      {!loaded && <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>{loading ? "⏳ טוען את רשימת הדיוור..." : "לא ניתן לטעון את רשימת הדיוור"}</div>}
      {loaded && tab === "contacts" && (
        <ContactsTab contacts={state.contacts} counts={counts} allTags={allTags} clientNames={clientNames}
          run={run} api={api} reload={load} onErr={handleErr} notify={notify} />
      )}
      {loaded && tab === "compose" && (
        <ComposeTab key={draft ? draft._key : "new"} initial={draft} contacts={state.contacts} allTags={allTags} quota={state.quota}
          user={user} run={run} reload={load}
          onQueued={() => { setDraft(null); setTab("history"); }} />
      )}
      {loaded && tab === "history" && (
        <HistoryTab campaigns={state.campaigns} run={run} reload={load}
          onOpen={(c, asCopy) => {
            setDraft({ ...c, id: asCopy ? undefined : c.id, tags: splitTags(c.tags), _key: Date.now() });
            setTab("compose");
          }} />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#0f172a", color: "#fff", padding: "12px 22px", borderRadius: 10, fontWeight: 600, zIndex: 200, boxShadow: "0 8px 30px #0004" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ contacts

function ContactsTab({ contacts, counts, allTags, clientNames, run, api, reload, onErr, notify }) {
  const [statusFilter, setStatusFilter] = useState(counts.candidate > 0 ? "candidate" : "active");
  const [tagFilter, setTagFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null);
  const [sortBy, setSortBy] = useState("seen");

  const list = useMemo(() => {
    let l = contacts;
    if (statusFilter !== "all") l = l.filter(c => c.status === statusFilter);
    if (tagFilter) l = l.filter(c => splitTags(c.tags).includes(tagFilter));
    if (search) {
      const q = search.toLowerCase();
      l = l.filter(c => [c.email, c.name, c.company, c.tags].some(v => String(v || "").toLowerCase().includes(q)));
    }
    const by = {
      seen: (a, b) => (Number(b.seenCount) || 0) - (Number(a.seenCount) || 0) || String(b.lastSeen).localeCompare(String(a.lastSeen)),
      recent: (a, b) => String(b.lastSeen || b.addedAt).localeCompare(String(a.lastSeen || a.addedAt)),
      company: (a, b) => String(a.company || "~").localeCompare(String(b.company || "~"), "he"),
      email: (a, b) => String(a.email).localeCompare(String(b.email)),
    }[sortBy];
    return [...l].sort(by);
  }, [contacts, statusFilter, tagFilter, search, sortBy]);

  const PAGE = 200;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); setSelected(new Set()); }, [statusFilter, tagFilter, search]);
  const shown = list.slice(0, limit);

  const allShownSelected = shown.length > 0 && shown.every(c => selected.has(c.email));
  function toggleAll() {
    const s = new Set(selected);
    if (allShownSelected) shown.forEach(c => s.delete(c.email));
    else shown.forEach(c => s.add(c.email));
    setSelected(s);
  }
  function toggle(email) {
    const s = new Set(selected);
    s.has(email) ? s.delete(email) : s.add(email);
    setSelected(s);
  }

  async function bulk(fields, msg) {
    const chosen = contacts.filter(c => selected.has(c.email));
    const upd = chosen.map(c => {
      const out = { email: c.email };
      if (fields.status) out.status = fields.status;
      if (fields.addTag) out.tags = [...splitTags(c.tags), fields.addTag].join(", ");
      return out;
    });
    const d = await run("mail.saveContacts", { contacts: upd }, msg);
    if (d) { setSelected(new Set()); reload(); }
  }

  async function bulkDelete() {
    if (!confirm(`למחוק ${selected.size} אנשי קשר לצמיתות? (עדיף לסמן "לא לדיוור" כדי שהסריקה לא תוסיף אותם שוב)`)) return;
    const d = await run("mail.deleteContacts", { emails: Array.from(selected) }, x => `נמחקו ${x.deleted}`);
    if (d) { setSelected(new Set()); reload(); }
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[{ id: "all", label: "הכל", color: "#0f172a" }, ...CONTACT_STATUSES].map(s => (
          <div key={s.id} onClick={() => setStatusFilter(s.id)}
            style={{ ...card, padding: "12px 16px", cursor: "pointer", border: statusFilter === s.id ? "2px solid " + s.color : "2px solid transparent" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.id === "all" ? contacts.length : counts[s.id] || 0}</div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {statusFilter === "candidate" && counts.candidate > 0 && (
        <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 10, padding: "10px 16px", marginBottom: 14, fontSize: 13, color: "#92400e" }}>
          כתובות שנמצאו במיילים. הן לא יקבלו דיוור עד שתאשרו אותן. סמנו לקוחות ← "אישור לדיוור", וספקים/סוכנים ← "לא לדיוור".
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  חיפוש מייל, שם, חברה, תגית..." style={{ ...inputStyle, flex: 1, minWidth: 200, background: "#fff" }} />
        <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={{ ...inputStyle, width: "auto", background: "#fff" }}>
          <option value="">כל התגיות</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...inputStyle, width: "auto", background: "#fff" }}>
          <option value="seen">מיון: הכי הרבה מיילים</option>
          <option value="recent">מיון: נראה לאחרונה</option>
          <option value="company">מיון: חברה</option>
          <option value="email">מיון: מייל</option>
        </select>
        <button onClick={() => setModal({ type: "edit", contact: null })} style={btn()}>+ איש קשר</button>
        <button onClick={() => setModal({ type: "import" })} style={btn("#0ea5e9")}>⬆ ייבוא רשימה</button>
        <button onClick={() => setModal({ type: "scan" })} style={btn("#8b5cf6")}>🔎 סריקת מיילים</button>
      </div>

      {selected.size > 0 && (
        <div style={{ ...card, padding: "10px 16px", marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#eef2ff" }}>
          <b style={{ fontSize: 13 }}>{selected.size} נבחרו:</b>
          <button onClick={() => bulk({ status: "active" }, "אושרו לדיוור")} style={btn("#10b981")}>✓ אישור לדיוור</button>
          <button onClick={() => bulk({ status: "rejected" }, "סומנו כלא לדיוור")} style={btn("#94a3b8")}>✕ לא לדיוור</button>
          <button onClick={() => setModal({ type: "tag" })} style={btn("#6366f1")}>🏷 הוספת תגית</button>
          <button onClick={bulkDelete} style={btn("#fef2f2", "#ef4444")}>🗑 מחיקה</button>
          <button onClick={() => setSelected(new Set())} style={btn("#fff", "#475569")}>ביטול בחירה</button>
        </div>
      )}

      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <div style={{ minWidth: 820 }}>
          <div style={{ display: "grid", gridTemplateColumns: "36px 2fr 1.2fr 1.2fr 1.3fr 1fr 0.9fr 0.6fr", gap: 10, padding: "11px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 12, fontWeight: 700, color: "#64748b" }}>
            <input type="checkbox" checked={allShownSelected} onChange={toggleAll} />
            <span>מייל</span><span>שם</span><span>חברה</span><span>תגיות</span><span>סטטוס</span><span>נראה לאחרונה</span><span>מיילים</span>
          </div>
          {shown.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>אין אנשי קשר להצגה</div>}
          {shown.map(c => {
            const st = CONTACT_STATUS_MAP[c.status] || { label: c.status, color: "#64748b" };
            return (
              <div key={c.email} onClick={() => setModal({ type: "edit", contact: c })}
                style={{ display: "grid", gridTemplateColumns: "36px 2fr 1.2fr 1.2fr 1.3fr 1fr 0.9fr 0.6fr", gap: 10, padding: "10px 16px", borderBottom: "1px solid #f1f5f9", fontSize: 13, alignItems: "center", cursor: "pointer", background: selected.has(c.email) ? "#eef2ff" : "transparent" }}>
                <input type="checkbox" checked={selected.has(c.email)} onClick={e => e.stopPropagation()} onChange={() => toggle(c.email)} />
                <span style={{ direction: "ltr", textAlign: "right", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</span>
                <span style={{ color: "#334155" }}>{c.name || "-"}</span>
                <span style={{ color: "#334155" }}>{c.company || "-"}</span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {splitTags(c.tags).map(t => <span key={t} style={{ background: "#ede9fe", color: "#6366f1", borderRadius: 12, padding: "1px 8px", fontSize: 11, fontWeight: 600 }}>{t}</span>)}
                </span>
                <span><Pill color={st.color}>{st.label}</Pill></span>
                <span style={{ color: "#94a3b8", fontSize: 12 }}>{String(c.lastSeen || "").slice(0, 10) || "-"}</span>
                <span style={{ color: "#64748b" }}>{c.seenCount || "-"}</span>
              </div>
            );
          })}
          {list.length > limit && (
            <div style={{ textAlign: "center", padding: 14 }}>
              <button onClick={() => setLimit(limit + PAGE)} style={btn("#f1f5f9", "#475569")}>הצגת עוד ({list.length - limit} נותרו)</button>
            </div>
          )}
        </div>
      </div>

      {modal?.type === "edit" && (
        <ContactForm contact={modal.contact} allTags={allTags} clientNames={clientNames} onClose={() => setModal(null)}
          onSave={async c => {
            const d = await run("mail.saveContacts", { contacts: [c] }, "נשמר");
            if (d) { setModal(null); reload(); }
          }} />
      )}
      {modal?.type === "tag" && (
        <TagModal allTags={allTags} onClose={() => setModal(null)}
          onSave={t => { setModal(null); bulk({ addTag: t }, `נוספה התגית "${t}"`); }} />
      )}
      {modal?.type === "import" && (
        <ImportModal allTags={allTags} onClose={() => setModal(null)}
          onImport={async (rows, status) => {
            const d = await run("mail.importContacts", { contacts: rows, status }, x => `נוספו ${x.added}, עודכנו ${x.updated}`);
            if (d) { setModal(null); reload(); }
          }} />
      )}
      {modal?.type === "scan" && (
        <ScanModal api={api} onErr={onErr} onClose={() => { setModal(null); reload(); }} notify={notify} />
      )}
    </>
  );
}

function ContactForm({ contact, allTags, clientNames, onSave, onClose }) {
  const [f, setF] = useState(contact ? { ...contact, tags: contact.tags || "" } : { email: "", name: "", company: "", tags: "", status: "active", notes: "" });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  return (
    <Modal title={contact ? "עריכת איש קשר" : "איש קשר חדש"} onClose={onClose}>
      <Field label="מייל *">
        <input style={{ ...inputStyle, direction: "ltr" }} value={f.email} onChange={set("email")} disabled={!!contact} placeholder="name@company.com" />
      </Field>
      <Field label="שם"><input style={inputStyle} value={f.name} onChange={set("name")} /></Field>
      <Field label="חברה">
        <input style={inputStyle} value={f.company} onChange={set("company")} list="crm-clients" />
        <datalist id="crm-clients">{clientNames.map(c => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="תגיות" hint="מופרדות בפסיק. לדוגמה: יבואנים, טורקיה, VIP">
        <input style={inputStyle} value={f.tags} onChange={set("tags")} list="tag-list" />
        <datalist id="tag-list">{allTags.map(t => <option key={t} value={t} />)}</datalist>
      </Field>
      <Field label="סטטוס">
        <select style={inputStyle} value={f.status} onChange={set("status")}>
          {CONTACT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="הערות"><textarea style={{ ...inputStyle, minHeight: 60 }} value={f.notes || ""} onChange={set("notes")} /></Field>
      {contact && <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>מקור: {contact.source || "-"} · נוסף: {String(contact.addedAt || "").slice(0, 10)}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btn("#f1f5f9", "#475569")}>ביטול</button>
        <button disabled={!validEmail} onClick={() => onSave({ email: f.email.trim(), name: f.name, company: f.company, tags: f.tags, status: f.status, notes: f.notes || "" })}
          style={{ ...btn(), opacity: validEmail ? 1 : 0.5 }}>שמירה</button>
      </div>
    </Modal>
  );
}

function TagModal({ allTags, onSave, onClose }) {
  const [t, setT] = useState("");
  return (
    <Modal title="הוספת תגית לנבחרים" onClose={onClose} width={400}>
      <Field label="תגית">
        <input autoFocus style={inputStyle} value={t} onChange={e => setT(e.target.value)} list="tag-list2" onKeyDown={e => e.key === "Enter" && t.trim() && onSave(t.trim())} />
        <datalist id="tag-list2">{allTags.map(x => <option key={x} value={x} />)}</datalist>
      </Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btn("#f1f5f9", "#475569")}>ביטול</button>
        <button onClick={() => t.trim() && onSave(t.trim())} style={btn()}>הוספה</button>
      </div>
    </Modal>
  );
}

// Paste from Excel (tab separated) or CSV: one contact per line, the column
// with an @ is the email, the next text columns are name and company.
export function parseContactLines(text) {
  const out = [];
  const seen = new Set();
  String(text || "").split(/\r?\n/).forEach(line => {
    const cols = line.split(/\t|,|;/).map(c => c.trim().replace(/^"|"$/g, ""));
    const idx = cols.findIndex(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
    if (idx === -1) return;
    const email = cols[idx].toLowerCase();
    if (seen.has(email)) return;
    seen.add(email);
    const rest = cols.filter((c, i) => i !== idx && c && !/@/.test(c));
    out.push({ email, name: rest[0] || "", company: rest[1] || "" });
  });
  return out;
}

function ImportModal({ allTags, onImport, onClose }) {
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseContactLines(text), [text]);
  function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setText(String(r.result));
    r.readAsText(file, "utf-8");
  }
  return (
    <Modal title="ייבוא רשימת לקוחות" onClose={onClose} width={600}>
      <Field label="הדבקה מאקסל או קובץ CSV" hint="שורה לכל לקוח. העמודה עם המייל מזוהה לבד; העמודות הבאות: שם, חברה. מקסל: לשמור כ-CSV UTF-8, או פשוט להעתיק ולהדביק.">
        <textarea style={{ ...inputStyle, minHeight: 160, direction: "ltr", textAlign: "left", fontFamily: "monospace", fontSize: 12 }} value={text} onChange={e => setText(e.target.value)}
          placeholder={"dana@acme.co.il\tדנה לוי\tאקמה בע\"מ\nmoshe@import.com, משה כהן, יבוא בע\"מ"} />
        <input type="file" accept=".csv,.txt" onChange={onFile} style={{ marginTop: 8, fontSize: 13 }} />
      </Field>
      <Field label="תגיות לכל המיובאים" hint="לדוגמה: יבואנים, טורקיה">
        <input style={inputStyle} value={tags} onChange={e => setTags(e.target.value)} list="tag-list3" />
        <datalist id="tag-list3">{allTags.map(t => <option key={t} value={t} />)}</datalist>
      </Field>
      <Field label="סטטוס" hint="מי שהסיר את עצמו או שהכתובת שלו חזרה לא יחזור לרשימה בייבוא.">
        <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="active">פעיל – לקוחות שמסכימים לקבל דיוור</option>
          <option value="candidate">ממתין לאישור – אבדוק אחד-אחד</option>
        </select>
      </Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#475569" }}>זוהו <b>{rows.length}</b> כתובות</span>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={btn("#f1f5f9", "#475569")}>ביטול</button>
          <button disabled={!rows.length || busy} onClick={async () => { setBusy(true); await onImport(rows.map(r => ({ ...r, tags })), status); setBusy(false); }}
            style={{ ...btn("#0ea5e9"), opacity: rows.length && !busy ? 1 : 0.5 }}>{busy ? "מייבא..." : `ייבוא ${rows.length}`}</button>
        </div>
      </div>
    </Modal>
  );
}

function ScanModal({ api, onErr, onClose, notify }) {
  const [days, setDays] = useState(365);
  const [progress, setProgress] = useState(null);
  const stopRef = useRef(false);

  async function scan() {
    stopRef.current = false;
    let start = 0, scanned = 0, added = 0, updated = 0;
    setProgress({ scanned, added, updated, running: true });
    try {
      while (!stopRef.current) {
        const d = await api("mail.scan", { days, start });
        scanned += d.scanned; added += d.added; updated += d.updated; start = d.nextStart;
        setProgress({ scanned, added, updated, running: !d.done });
        if (d.done) break;
      }
      notify(`הסריקה הסתיימה: ${added} כתובות חדשות ממתינות לאישור`);
    } catch (e) {
      onErr(e);
    }
    setProgress(p => p && { ...p, running: false });
  }

  return (
    <Modal title="סריקת מיילים לאיתור לקוחות" onClose={() => { stopRef.current = true; onClose(); }}>
      <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, marginBottom: 14 }}>
        עובר על התיבה של חשבון המערכת ואוסף כתובות מ"מאת/אל/עותק" ומכותרות של מיילים מועברים. כתובות חדשות נכנסות כ<b>ממתינות לאישור</b> ולא מקבלות דיוור עד שתאשרו.
        כתובות של alpha-lg.com, חברות ספנות ו-noreply מסוננות.
        <br />לסריקת תיבות אישיות (שלך, של אנשי המכירות) יש סקריפט נפרד: <code>apps-script/ContactScanner.gs</code>.
      </div>
      <Field label="תקופה">
        <select style={inputStyle} value={days} onChange={e => setDays(Number(e.target.value))} disabled={progress?.running}>
          <option value={30}>חודש אחרון</option>
          <option value={180}>חצי שנה</option>
          <option value={365}>שנה</option>
          <option value={730}>שנתיים</option>
          <option value={1825}>5 שנים</option>
        </select>
      </Field>
      {progress && (
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 16px", marginBottom: 14, fontSize: 14 }}>
          {progress.running ? "⏳ סורק... (כל שלב עד 4 דקות)" : "✓ הסתיים"}
          <div style={{ marginTop: 6, color: "#475569" }}>שרשורים שנסרקו: <b>{progress.scanned}</b> · כתובות חדשות: <b>{progress.added}</b> · עודכנו: <b>{progress.updated}</b></div>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        {progress?.running
          ? <button onClick={() => { stopRef.current = true; }} style={btn("#f1f5f9", "#475569")}>עצירה אחרי השלב הנוכחי</button>
          : <button onClick={onClose} style={btn("#f1f5f9", "#475569")}>סגירה</button>}
        {!progress?.running && <button onClick={scan} style={btn("#8b5cf6")}>התחלת סריקה</button>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ compose

function ComposeTab({ initial, contacts, allTags, quota, user, run, reload, onQueued }) {
  const empty = { id: undefined, type: "marketing", isAd: true, subject: "", body: "", format: "text", tags: [] };
  const [c, setC] = useState(initial ? { ...empty, ...initial } : empty);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));

  const audience = useMemo(() => audienceOf(contacts, c.tags), [contacts, c.tags]);
  const tagCounts = useMemo(() => {
    const m = {};
    contacts.filter(x => x.status === "active").forEach(x => splitTags(x.tags).forEach(t => { m[t] = (m[t] || 0) + 1; }));
    return m;
  }, [contacts]);

  const payload = () => ({ ...c, tags: c.tags.join(", ") });
  const ready = c.subject.trim() && c.body.trim();

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
    await run("mail.testSend", { campaign: payload() }, d => `מייל ניסיון נשלח ל-${d.to}`);
    setBusy("");
  }

  async function send() {
    const days = quota ? Math.ceil(audience.length / Math.max(quota, 1)) : 1;
    const msg = `לשלוח את "${c.subject}" ל-${audience.length} נמענים?` +
      (audience.length > (quota || 0) ? `\n\nהמכסה היומית של Gmail תפרוס את השליחה על כ-${days} ימים.` : "") +
      "\n\nהשליחה מתחילה בתוך כמה דקות ונמשכת במנות.";
    if (!confirm(msg)) return;
    const saved = await save(true);
    if (!saved) return;
    setBusy("send");
    const d = await run("mail.queueCampaign", { id: saved.id }, x => `הדיוור נכנס לתור: ${x.total} נמענים`);
    setBusy("");
    if (d) { reload(); onQueued(); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18, alignItems: "start" }}>
      <div style={card}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {CAMPAIGN_TYPES.map(t => (
            <button key={t.id} onClick={() => setC(x => ({ ...x, type: t.id, isAd: t.isAd }))}
              style={{ ...btn(c.type === t.id ? "#6366f1" : "#f1f5f9", c.type === t.id ? "#fff" : "#475569") }}>{t.label}</button>
          ))}
        </div>
        <Field label="נושא המייל *">
          <input style={inputStyle} value={c.subject} onChange={e => set("subject", e.target.value)} placeholder="לדוגמה: מחירי הובלה מטורקיה לנובמבר" />
        </Field>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#475569", marginBottom: 14 }}>
          <input type="checkbox" checked={c.isAd} onChange={e => set("isAd", e.target.checked)} />
          לסמן כ"פרסומת" בתחילת הנושא (נדרש בחוק לדיוור שיווקי)
        </label>
        <Field label="תוכן *" hint={c.format === "text"
          ? "שורה ריקה = פסקה חדשה · ## כותרת · - תבליט · **מודגש** · קישורים נהיים לחיצים · {{שם}} {{שם פרטי}} {{חברה}} מוחלפים בפרטי הנמען"
          : "HTML חופשי. {{שם}} {{חברה}} עובדים גם כאן. הכותרת, הפוטר וקישור ההסרה מתווספים אוטומטית."}>
          <textarea style={{ ...inputStyle, minHeight: 280, lineHeight: 1.6, fontFamily: c.format === "html" ? "monospace" : "inherit" }} value={c.body} onChange={e => set("body", e.target.value)}
            placeholder={"שלום {{שם פרטי}},\n\n## עדכון מחירים לחודש הקרוב\n\n- מרסין ← אשדוד, 40': ...\n- איסטנבול ← חיפה, 20': ...\n\nלהצעת מחיר מותאמת אפשר פשוט להשיב למייל הזה.\n\nבברכה,\nיואב"} />
          <label style={{ fontSize: 12, color: "#64748b", display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
            <input type="checkbox" checked={c.format === "html"} onChange={e => set("format", e.target.checked ? "html" : "text")} /> מצב HTML
          </label>
        </Field>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={() => save(false)} disabled={!!busy} style={btn("#f1f5f9", "#475569")}>{busy === "save" ? "שומר..." : "💾 שמירת טיוטה"}</button>
          <button onClick={showPreview} disabled={!ready || !!busy} style={{ ...btn("#e0e7ff", "#4338ca"), opacity: ready ? 1 : 0.5 }}>{busy === "preview" ? "..." : "👁 תצוגה מקדימה"}</button>
          <button onClick={testSend} disabled={!ready || !!busy} style={{ ...btn("#e0f2fe", "#0369a1"), opacity: ready ? 1 : 0.5 }}>{busy === "test" ? "שולח..." : `🧪 ניסיון אליי (${user.email})`}</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: 10, color: "#0f172a" }}>למי לשלוח</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>בלי בחירה = כל אנשי הקשר הפעילים. בחירת תגיות = מי שיש לו לפחות אחת מהן.</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {allTags.length === 0 && <span style={{ fontSize: 12, color: "#cbd5e1" }}>אין עדיין תגיות</span>}
          {allTags.map(t => {
            const on = c.tags.includes(t);
            return (
              <span key={t} onClick={() => set("tags", on ? c.tags.filter(x => x !== t) : [...c.tags, t])}
                style={{ cursor: "pointer", borderRadius: 16, padding: "4px 12px", fontSize: 12, fontWeight: 700, background: on ? "#6366f1" : "#ede9fe", color: on ? "#fff" : "#6366f1" }}>
                {t} ({tagCounts[t] || 0})
              </span>
            );
          })}
        </div>
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#0f172a" }}>{audience.length}</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>נמענים פעילים{quota !== null && audience.length > quota ? ` · יותר מהמכסה היומית (${quota}), יישלח על פני כמה ימים` : ""}</div>
        </div>
        <button onClick={send} disabled={!ready || !audience.length || !!busy}
          style={{ ...btn("#10b981"), width: "100%", padding: 13, fontSize: 15, opacity: ready && audience.length ? 1 : 0.5 }}>
          {busy === "send" ? "מכניס לתור..." : `📤 שליחה ל-${audience.length} נמענים`}
        </button>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10, lineHeight: 1.5 }}>
          כל מייל נשלח בנפרד לכל נמען (בלי שהנמענים רואים זה את זה), עם קישור הסרה. מי שמסיר את עצמו לא יקבל יותר דיוורים.
        </div>
      </div>

      {preview && (
        <Modal title="תצוגה מקדימה" onClose={() => setPreview(null)} width={700}>
          <div style={{ fontSize: 13, color: "#475569", marginBottom: 10 }}>נושא: <b>{preview.subject}</b></div>
          <iframe title="preview" srcDoc={preview.html} sandbox="" style={{ width: "100%", height: "60vh", border: "1px solid #e2e8f0", borderRadius: 10 }} />
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ history

function HistoryTab({ campaigns, run, reload, onOpen }) {
  useEffect(() => {
    if (!campaigns.some(c => c.status === "sending")) return;
    const t = setInterval(reload, 60000);
    return () => clearInterval(t);
  }, [campaigns]);

  if (!campaigns.length) return <div style={{ ...card, textAlign: "center", color: "#94a3b8", padding: 40 }}>עוד לא נשלחו דיוורים</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {campaigns.map(c => {
        const st = CAMPAIGN_STATUSES[c.status] || { label: c.status, color: "#64748b" };
        const total = Number(c.total) || 0, sent = Number(c.sent) || 0, failed = Number(c.failed) || 0;
        const pct = total ? Math.round(((sent + failed) / total) * 100) : 0;
        return (
          <div key={c.id} style={{ ...card, padding: "14px 18px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Pill color={st.color}>{st.label}</Pill>
              <span style={{ fontSize: 12, color: "#6366f1", fontWeight: 700 }}>{CAMPAIGN_TYPE_MAP[c.type]?.label || c.type}</span>
              <b style={{ fontSize: 15, color: "#0f172a", flex: 1, minWidth: 200 }}>{c.subject || "(ללא נושא)"}</b>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{String(c.createdAt).replace("T", " ")} · {c.createdBy}</span>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              {c.status !== "draft" && (
                <>
                  <div style={{ flex: 1, minWidth: 160, height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: pct + "%", height: "100%", background: st.color }} />
                  </div>
                  <span style={{ fontSize: 13, color: "#475569" }}>נשלחו <b>{sent}</b> מתוך {total}{failed ? <span style={{ color: "#ef4444" }}> · נכשלו {failed}</span> : null}</span>
                </>
              )}
              {c.tags && <span style={{ fontSize: 12, color: "#64748b" }}>קהל: {c.tags}</span>}
              {!c.tags && c.status !== "draft" && <span style={{ fontSize: 12, color: "#64748b" }}>קהל: כל הפעילים</span>}
              <div style={{ flex: c.status === "draft" ? 1 : 0 }} />
              {c.status === "draft" && <button onClick={() => onOpen(c, false)} style={btn()}>✏️ המשך עריכה</button>}
              {c.status === "draft" && <button onClick={async () => { if (confirm("למחוק את הטיוטה?") && await run("mail.deleteCampaign", { id: c.id }, "נמחק")) reload(); }} style={btn("#fef2f2", "#ef4444")}>🗑</button>}
              {c.status === "sending" && <button onClick={async () => { if (confirm("לעצור את השליחה? מי שכבר קיבל – קיבל.") && await run("mail.cancelCampaign", { id: c.id }, "השליחה נעצרה")) reload(); }} style={btn("#fef2f2", "#ef4444")}>⏹ עצירה</button>}
              {c.status !== "draft" && <button onClick={() => onOpen(c, true)} style={btn("#f1f5f9", "#475569")}>⧉ שכפול</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
