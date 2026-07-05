import { useState, useMemo, useEffect, useRef } from "react";

const QUOTE_STATUSES = [
  { id: "waiting_supplier", label: "ממתין למחיר ספק", color: "#f59e0b", icon: "⏳", desc: "טרם קיבלנו מחיר מהספק" },
  { id: "sent_to_client", label: "נשלח ללקוח", color: "#3b82f6", icon: "📤", desc: "ענינו ללקוח, מחכים לתשובה" },
  { id: "won", label: "זכינו", color: "#10b981", icon: "✅", desc: "" },
  { id: "too_expensive", label: "יקר מדי", color: "#ef4444", icon: "💸", desc: "הלקוח ציין שהמחיר גבוה" },
  { id: "cancelled", label: "בוטל", color: "#94a3b8", icon: "🚫", desc: "" },
];

const STATUS_MAP = Object.fromEntries(QUOTE_STATUSES.map(s => [s.id, s]));

const initialQuotes = [
  { id: 1, client: "דנה לוי", topic: "מערכת מיזוג אוויר", status: "waiting_supplier", suppliers: ["קלימטק", "אייר פרו"], notes: "ביקשה 3 יחידות", date: "2026-06-20" },
  { id: 2, client: "אמיר כהן", topic: "פאנלים סולאריים", status: "sent_to_client", suppliers: ["סולאר ישראל"], notes: "", date: "2026-06-18" },
  { id: 3, client: "מיכל ברק", topic: "גנרטור גיבוי", status: "too_expensive", suppliers: ["גנרטק"], notes: "ביקשה הנחה של 15%", date: "2026-06-15" },
  { id: 4, client: "רון שמיר", topic: "מערכת חשמל תעשייתי", status: "waiting_supplier", suppliers: [], notes: "צריך לפנות לספקים", date: "2026-06-22" },
  { id: 5, client: "ליאת גולן", topic: "תאורת LED מחסן", status: "won", suppliers: ["לייטקס"], notes: "", date: "2026-06-10" },
];

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxAm88pe-7sN81UQYSfdCdQ5gKJdaSyf0IbOnuXHjCBTP8Z-e-w108KVeiQ0jWRZflPnQ/exec";

async function syncToSheet(quotes, email) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === "REPLACE_WITH_APPS_SCRIPT_URL") return;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ quotes, email }),
    });
  } catch (e) {
    console.error("Sync to Google Sheet failed:", e);
  }
}

const ADMIN_EMAIL = "yoav@alpha-lg.com";
const ALLOWED_DOMAIN = "alpha-lg.com";
const GOOGLE_CLIENT_ID = "1004123335005-7ls478147cttelsda0eeavbj7o0pd2ue.apps.googleusercontent.com";

function decodeJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

function LoginScreen({ onLogin, error }) {
  const btnRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    function trySetup() {
      if (cancelled) return;
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            const payload = decodeJwt(response.credential);
            if (payload) onLogin(payload);
          },
        });
        if (btnRef.current) {
          window.google.accounts.id.renderButton(btnRef.current, { theme: "outline", size: "large", text: "signin_with", locale: "he" });
        }
      } else {
        setTimeout(trySetup, 200);
      }
    }
    trySetup();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f8fafc", direction: "rtl", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
      <h2 style={{ marginBottom: 6, color: "#0f172a" }}>מעקב הצעות מחיר</h2>
      <p style={{ color: "#64748b", marginBottom: 24 }}>יש להתחבר עם חשבון Google של alpha-lg.com</p>
      <div ref={btnRef}></div>
      {error && <div style={{ color: "#ef4444", marginTop: 16, fontSize: 13, fontWeight: 600 }}>{error}</div>}
    </div>
  );
}


function StatusBadge({ statusId, size = "md" }) {
  const s = STATUS_MAP[statusId];
  if (!s) return null;
  const pad = size === "sm" ? "2px 9px" : "4px 13px";
  const fs = size === "sm" ? 11 : 13;
  return (
    <span style={{ background: s.color + "20", color: s.color, border: "1.5px solid " + s.color + "44", borderRadius: 20, padding: pad, fontSize: fs, fontWeight: 700, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
      {s.icon} {s.label}
    </span>
  );
}

function Modal({ title, onClose, children, width = 460 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000066", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width, maxWidth: "95vw", boxShadow: "0 20px 60px #0003", direction: "rtl", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = { width: "100%", padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, color: "#0f172a", outline: "none", background: "#f8fafc", boxSizing: "border-box", fontFamily: "inherit" };

function QuoteForm({ initial, onSave, onClose, clientOptions = [], supplierOptions = [] }) {
  const empty = { client: "", topic: "", status: "waiting_supplier", suppliers: [], notes: "", date: new Date().toISOString().slice(0, 10) };
  const [form, setForm] = useState(initial || empty);
  const [supplierInput, setSupplierInput] = useState("");
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function addSupplier() {
    const s = supplierInput.trim();
    if (s && !form.suppliers.includes(s)) {
      setForm(f => ({ ...f, suppliers: [...f.suppliers, s] }));
    }
    setSupplierInput("");
  }

  function removeSupplier(s) {
    setForm(f => ({ ...f, suppliers: f.suppliers.filter(x => x !== s) }));
  }

  return (
    <>
      <Field label="שם לקוח *">
        <input style={inputStyle} value={form.client} onChange={set("client")} placeholder="שם הלקוח" list="client-options-list" />
        <datalist id="client-options-list">
          {clientOptions.map(c => <option key={c} value={c} />)}
        </datalist>
      </Field>
      <Field label="נושא ההצעה *">
        <input style={inputStyle} value={form.topic} onChange={set("topic")} placeholder="תיאור קצר של הבקשה" />
      </Field>
      <Field label="תאריך בקשה">
        <input style={inputStyle} type="date" value={form.date} onChange={set("date")} />
      </Field>
      <Field label="סטטוס">
        <select style={inputStyle} value={form.status} onChange={set("status")}>
          {QUOTE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
        </select>
      </Field>
      <Field label="ספקים מעורבים">
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} value={supplierInput} onChange={e => setSupplierInput(e.target.value)} placeholder="שם ספק" onKeyDown={e => e.key === "Enter" && addSupplier()} list="supplier-options-list" />
          <datalist id="supplier-options-list">
            {supplierOptions.map(s => <option key={s} value={s} />)}
          </datalist>
          <button onClick={addSupplier} style={{ padding: "9px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>+ הוסף</button>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {form.suppliers.map(s => (
            <span key={s} style={{ background: "#ede9fe", color: "#6366f1", borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              {s}
              <span onClick={() => removeSupplier(s)} style={{ cursor: "pointer", color: "#a78bfa", fontWeight: 900 }}>×</span>
            </span>
          ))}
          {form.suppliers.length === 0 && <span style={{ fontSize: 12, color: "#cbd5e1" }}>טרם הוסף ספק</span>}
        </div>
      </Field>
      <Field label="הערות">
        <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} value={form.notes} onChange={set("notes")} placeholder="הערות נוספות..." />
      </Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={onClose} style={{ padding: "9px 20px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>ביטול</button>
        <button onClick={() => form.client && form.topic && onSave(form)} style={{ padding: "9px 22px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>שמירה</button>
      </div>
    </>
  );
}

export default function QuoteCRM() {
  const [quotes, setQuotes] = useState([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState("");

  // Restore session (if previously validated in this browser tab)
  useEffect(() => {
    const saved = sessionStorage.getItem("crm_user");
    if (saved) {
      try { setUser(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  function handleLogin(payload) {
    const email = (payload.email || "").toLowerCase();
    if (!email.endsWith("@" + ALLOWED_DOMAIN)) {
      setAuthError("רק משתמשים עם מייל alpha-lg.com יכולים להתחבר");
      return;
    }
    const u = { email, name: payload.name || email, picture: payload.picture || "" };
    sessionStorage.setItem("crm_user", JSON.stringify(u));
    setAuthError("");
    setUser(u);
  }

  function handleLogout() {
    sessionStorage.removeItem("crm_user");
    setUser(null);
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }

  // Load data from Google Sheet once logged in
  useEffect(() => {
    if (!user) return;
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === "REPLACE_WITH_APPS_SCRIPT_URL") { setIsLoading(false); return; }
    setIsLoading(true);
    fetch(APPS_SCRIPT_URL + "?email=" + encodeURIComponent(user.email))
      .then(r => r.json())
      .then(data => {
        if (data.quotes && Array.isArray(data.quotes)) {
          setQuotes(data.quotes);
        }
      })
      .catch(e => console.error("Failed to load from Sheet:", e))
      .finally(() => setIsLoading(false));
  }, [user]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [sortBy, setSortBy] = useState("date");

  const closeModal = () => setModal(null);

  function saveQuote(data) {
    if (data.id) {
      setQuotes(qs => { const updated = qs.map(q => q.id === data.id ? { ...data, owner: q.owner || user.email } : q); syncToSheet(updated, user.email); return updated; });
    } else {
      setQuotes(qs => { const updated = [{ ...data, id: Date.now(), owner: user.email }, ...qs]; syncToSheet(updated, user.email); return updated; });
    }
    closeModal();
  }

  function deleteQuote(id) {
    if (confirm("למחוק הצעה זו?")) setQuotes(qs => { const updated = qs.filter(q => q.id !== id); syncToSheet(updated, user.email); return updated; });
    closeModal();
  }

  function changeStatus(id, status) {
    setQuotes(qs => { const updated = qs.map(q => q.id === id ? { ...q, status } : q); syncToSheet(updated, user.email); return updated; });
  }

  const visibleQuotes = useMemo(() => {
    if (!user) return [];
    return user.email === ADMIN_EMAIL ? quotes : quotes.filter(q => q.owner === user.email);
  }, [quotes, user]);

  const clientOptions = useMemo(() => {
    const set = new Set();
    visibleQuotes.forEach(q => { if (q.client) set.add(q.client); });
    return Array.from(set);
  }, [visibleQuotes]);

  const supplierOptions = useMemo(() => {
    const set = new Set();
    visibleQuotes.forEach(q => { (q.suppliers || []).forEach(s => { if (s) set.add(s); }); });
    return Array.from(set);
  }, [visibleQuotes]);

  const filtered = useMemo(() => {
    let qs = visibleQuotes;
    if (filterStatus !== "all") qs = qs.filter(q => q.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      qs = qs.filter(x => x.client.toLowerCase().includes(q) || x.topic.toLowerCase().includes(q) || x.suppliers.some(s => s.toLowerCase().includes(q)));
    }
    if (sortBy === "date") qs = [...qs].sort((a, b) => b.date.localeCompare(a.date));
    if (sortBy === "client") qs = [...qs].sort((a, b) => a.client.localeCompare(b.client));
    if (sortBy === "status") qs = [...qs].sort((a, b) => a.status.localeCompare(b.status));
    return qs;
  }, [visibleQuotes, filterStatus, search, sortBy]);

  const stats = useMemo(() => {
    const total = visibleQuotes.length;
    const byStatus = Object.fromEntries(QUOTE_STATUSES.map(s => [s.id, visibleQuotes.filter(q => q.status === s.id).length]));
    const noSupplier = visibleQuotes.filter(q => q.status === "waiting_supplier" && q.suppliers.length === 0).length;
    return { total, byStatus, noSupplier };
  }, [visibleQuotes]);

  if (!user) {
    return <LoginScreen onLogin={handleLogin} error={authError} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", direction: "rtl", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>📋</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a", letterSpacing: "-0.5px" }}>מעקב הצעות מחיר</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{stats.total} הצעות במערכת</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{user.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{user.email}{user.email === ADMIN_EMAIL ? " · אדמין" : ""}</div>
          </div>
          <button onClick={handleLogout} style={{ padding: "8px 14px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            התנתקות
          </button>
          <button onClick={() => setModal({ type: "new" })} style={{ padding: "10px 22px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            + הצעה חדשה
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
        {isLoading && (
          <div style={{ background: "#eff6ff", border: "1.5px solid #3b82f6", borderRadius: 10, padding: "12px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
            <span style={{ fontSize: 18 }}>⏳</span>
            <span style={{ color: "#1d4ed8", fontWeight: 600 }}>טוען נתונים מהגיליון...</span>
          </div>
        )}
        {/* Stats Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          {QUOTE_STATUSES.map(s => (
            <div key={s.id} onClick={() => setFilterStatus(filterStatus === s.id ? "all" : s.id)}
              style={{ background: "#fff", borderRadius: 12, padding: "16px 18px", cursor: "pointer", boxShadow: "0 1px 4px #0001", border: filterStatus === s.id ? "2px solid " + s.color : "2px solid transparent", transition: "all 0.15s" }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{stats.byStatus[s.id]}</div>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {stats.noSupplier > 0 && (
          <div style={{ background: "#fffbeb", border: "1.5px solid #f59e0b", borderRadius: 10, padding: "12px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <span style={{ color: "#92400e", fontWeight: 600 }}>{stats.noSupplier} הצעות ממתינות לספק ועדיין לא צוין ספק — יש לטפל!</span>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  חיפוש לקוח, נושא, ספק..." style={{ flex: 1, minWidth: 220, padding: "9px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", background: "#fff", direction: "rtl" }} />
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: "9px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#fff", color: "#475569" }}>
            <option value="date">מיון: תאריך</option>
            <option value="client">מיון: לקוח</option>
            <option value="status">מיון: סטטוס</option>
          </select>
          {filterStatus !== "all" && (
            <button onClick={() => setFilterStatus("all")} style={{ padding: "9px 14px", background: "#f1f5f9", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, color: "#475569", fontWeight: 600 }}>
              ✕ נקה פילטר
            </button>
          )}
        </div>

        {/* Table */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 6px #0001", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1.2fr 1.6fr 1fr", padding: "12px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 12, fontWeight: 700, color: "#64748b", gap: 12 }}>
            <span>לקוח</span>
            <span>נושא ההצעה</span>
            <span>ספקים</span>
            <span>סטטוס</span>
            <span>תאריך</span>
          </div>

          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 50, color: "#94a3b8", fontSize: 15 }}>לא נמצאו הצעות</div>
          )}

          {filtered.map((q, i) => {
            const isUrgent = q.status === "waiting_supplier" && q.suppliers.length === 0;
            return (
              <div key={q.id}
                onClick={() => setModal({ type: "view", quote: q })}
                style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1.2fr 1.6fr 1fr", padding: "14px 20px", gap: 12, borderBottom: i < filtered.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", background: isUrgent ? "#fffbeb" : "transparent", alignItems: "center", transition: "background 0.15s" }}
                onMouseEnter={e => !isUrgent && (e.currentTarget.style.background = "#f8fafc")}
                onMouseLeave={e => !isUrgent && (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 14 }}>
                  {isUrgent && <span style={{ marginLeft: 4 }}>⚠️</span>}
                  {q.client}
                </div>
                <div style={{ color: "#475569", fontSize: 14 }}>{q.topic}</div>
                <div>
                  {q.suppliers.length === 0
                    ? <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 600 }}>לא צוין</span>
                    : <span style={{ fontSize: 13, color: "#64748b" }}>{q.suppliers.join(", ")}</span>
                  }
                </div>
                <div><StatusBadge statusId={q.status} size="sm" /></div>
                <div style={{ fontSize: 13, color: "#94a3b8" }}>{q.date}</div>
              </div>
            );
          })}
        </div>
      </div>

      {modal?.type === "new" && (
        <Modal title="הצעת מחיר חדשה" onClose={closeModal}>
          <QuoteForm onSave={saveQuote} onClose={closeModal} clientOptions={clientOptions} supplierOptions={supplierOptions} />
        </Modal>
      )}

      {modal?.type === "edit" && (
        <Modal title="עריכת הצעה" onClose={closeModal}>
          <QuoteForm initial={modal.quote} onSave={q => saveQuote({ ...q, id: modal.quote.id })} onClose={closeModal} clientOptions={clientOptions} supplierOptions={supplierOptions} />
        </Modal>
      )}

      {modal?.type === "view" && modal.quote && (() => {
        const q = quotes.find(x => x.id === modal.quote.id) || modal.quote;
        const s = STATUS_MAP[q.status];
        return (
          <Modal title={q.topic} onClose={closeModal} width={500}>
            <div style={{ background: s.color + "12", border: "1.5px solid " + s.color + "33", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600, marginBottom: 8 }}>סטטוס נוכחי</div>
              <StatusBadge statusId={q.status} />
              {s.desc && <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>{s.desc}</div>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>לקוח</div>
                <div style={{ fontWeight: 700, color: "#0f172a" }}>{q.client}</div>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>תאריך בקשה</div>
                <div style={{ fontWeight: 700, color: "#0f172a" }}>{q.date}</div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>ספקים מעורבים</div>
              {q.suppliers.length === 0
                ? <div style={{ color: "#ef4444", fontSize: 14, fontWeight: 600 }}>⚠️ לא צוין ספק — יש לפנות לספק!</div>
                : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {q.suppliers.map(sup => (
                      <span key={sup} style={{ background: "#ede9fe", color: "#6366f1", borderRadius: 20, padding: "4px 14px", fontSize: 13, fontWeight: 600 }}>{sup}</span>
                    ))}
                  </div>
              }
            </div>

            {q.notes && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#92400e" }}>
                📝 {q.notes}
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>שנה סטטוס מהיר</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {QUOTE_STATUSES.filter(st => st.id !== q.status).map(st => (
                  <button key={st.id} onClick={() => changeStatus(q.id, st.id)}
                    style={{ padding: "6px 14px", background: st.color + "15", color: st.color, border: "1.5px solid " + st.color + "44", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    {st.icon} {st.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => deleteQuote(q.id)} style={{ padding: "9px 18px", background: "#fef2f2", color: "#ef4444", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>🗑️ מחיקה</button>
              <button onClick={() => setModal({ type: "edit", quote: q })} style={{ padding: "9px 22px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>✏️ עריכה</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
