// Mailing module for the CRM (same Apps Script project as Code.gs).
//
// Sheets (created automatically in the CRM spreadsheet):
//   contacts  - the mailing list
//   campaigns - every mailing that was drafted or sent
//   sendlog   - one row per recipient per campaign (the send queue)
//
// One-time setup after pasting this file:
//   1. Run setupMailing() once by hand (Run > setupMailing). It creates the
//      sheets, the secret keys and the time triggers, and logs the key that
//      ContactScanner.gs needs.
//   2. Deploy > Manage deployments > edit the web app > New version.
//      (Google will ask to approve new permissions: sending mail, UrlFetch.)
//
// Mail goes out from the mailbox this script runs as, in batches, so the
// Gmail daily quota (about 1,500 recipients a day on Google Workspace) is
// never exceeded: a large list is spread over more than one day by itself.

var MAIL_CFG = {
  SENDER_NAME: "Alpha Logistics | אלפא לוגיסטיקה",
  REPLY_TO: "yoav@alpha-lg.com",          // replies from customers go here
  FROM_ALIAS: "",                          // optional "send mail as" alias of this mailbox, e.g. "news@alpha-lg.com"
  FOOTER_LINES: [
    "אלפא לוגיסטיקה בע\"מ",
    "לבירורים: yoav@alpha-lg.com"
  ],
  BRAND_COLOR: "#1e3a8a",
  WEBAPP_URL: "https://script.google.com/macros/s/AKfycbxAm88pe-7sN81UQYSfdCdQ5gKJdaSyf0IbOnuXHjCBTP8Z-e-w108KVeiQ0jWRZflPnQ/exec",
  GOOGLE_CLIENT_ID: "1004123335005-7ls478147cttelsda0eeavbj7o0pd2ue.apps.googleusercontent.com",
  MAILING_USERS: ["yoav@alpha-lg.com", "einatb@alpha-lg.com"], // who may use the mailing screen
  BATCH_SIZE: 70,                          // mails per trigger run (every 5 minutes)
  SEND_TIME_BUDGET_MS: 4.5 * 60 * 1000,
  SCAN_TIME_BUDGET_MS: 4 * 60 * 1000,
  OWN_DOMAINS: ["alpha-lg.com"],
  // Addresses from these domains are never added as candidates (carriers, systems).
  EXCLUDE_DOMAINS: [
    "msc.com", "zim.com", "one-line.com", "oocl.com", "evergreen-line.com", "evergreen-shipping.co.il",
    "maersk.com", "cma-cgm.com", "hlag.com", "coscon.com", "cosco.com", "yangming.com",
    "google.com", "googlegroups.com", "facebookmail.com", "linkedin.com", "calendar-notification.google.com"
  ],
  FREEMAIL_DOMAINS: ["gmail.com", "googlemail.com", "walla.co.il", "walla.com", "yahoo.com", "hotmail.com",
    "outlook.com", "live.com", "icloud.com", "012.net.il", "bezeqint.net", "netvision.net.il", "zahav.net.il"]
};

var CONTACT_COLS = ["email", "name", "company", "tags", "status", "source", "addedAt", "lastSeen", "seenCount", "notes"];
var CAMPAIGN_COLS = ["id", "subject", "body", "format", "type", "isAd", "tags", "status", "createdBy", "createdAt", "total", "sent", "failed", "finishedAt"];
var LOG_COLS = ["campaignId", "email", "status", "at", "error"];
// contact status: active | candidate | unsubscribed | bounced | rejected
// campaign status: draft | sending | done | cancelled
// log status: pending | sent | failed | skipped

// ---------------------------------------------------------------- setup

function setupMailing() {
  mailSheet_("contacts", CONTACT_COLS);
  mailSheet_("campaigns", CAMPAIGN_COLS);
  mailSheet_("sendlog", LOG_COLS);
  mailSecret_();
  var scannerKey = scannerKey_();

  var handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (handlers.indexOf("processMailQueue") === -1) {
    ScriptApp.newTrigger("processMailQueue").timeBased().everyMinutes(5).create();
  }
  if (handlers.indexOf("scanMailboxDaily") === -1) {
    ScriptApp.newTrigger("scanMailboxDaily").timeBased().everyDays(1).atHour(5).create();
  }
  console.log("Mailing is set up. SCANNER_KEY for ContactScanner.gs: " + scannerKey);
}

function mailSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty("MAIL_SECRET");
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty("MAIL_SECRET", s); }
  return s;
}

function scannerKey_() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty("SCANNER_KEY");
  if (!k) { k = Utilities.getUuid().replace(/-/g, ""); props.setProperty("SCANNER_KEY", k); }
  return k;
}

// ---------------------------------------------------------------- sheets

function mailSheet_(name, cols) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold");
    sh.setFrozenRows(1);
    if (name === "contacts" || name === "sendlog") sh.getRange("A:A").setNumberFormat("@");
  }
  return sh;
}

function readTable_(sh, cols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = r[j] instanceof Date ? isoDate_(r[j]) : r[j]; });
    return o;
  });
}

function toRow_(obj, cols) {
  return cols.map(function (c) { return obj[c] === undefined || obj[c] === null ? "" : obj[c]; });
}

function isoDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
}

function nowIso_() { return isoDate_(new Date()); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------- auth

// Checks the Google sign-in token the CRM page got at login (not just an email
// the page claims), so nobody can send mail by calling the web app directly.
function verifyMailUser_(idToken) {
  if (!idToken) return null;
  var cache = CacheService.getScriptCache();
  var key = "tok_" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return hit;

  var res = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var info = JSON.parse(res.getContentText());
  if (info.aud !== MAIL_CFG.GOOGLE_CLIENT_ID) return null;
  if (String(info.email_verified) !== "true") return null;
  var email = String(info.email || "").toLowerCase();
  if (MAIL_CFG.MAILING_USERS.indexOf(email) === -1) return null;
  var ttl = Math.min(21600, Number(info.exp) - Math.floor(Date.now() / 1000));
  if (ttl > 0) cache.put(key, email, ttl);
  return email;
}

// ---------------------------------------------------------------- web app routing
// Code.gs doGet/doPost hand requests with an "action" to these two functions.

function handleMailingGet_(e) {
  if (e.parameter.action === "unsubscribe") return unsubscribePage_(e.parameter.e, e.parameter.t);
  return json_({ status: "error", error: "unknown action" });
}

function handleMailingPost_(body) {
  try {
    if (body.action === "mail.addCandidates") {
      if (!body.key || body.key !== scannerKey_()) return json_({ status: "auth" });
      var r = withLock_(function () { return mergeCandidates_(body.contacts || [], body.source || "scanner"); });
      return json_({ status: "ok", added: r.added, updated: r.updated });
    }

    var user = verifyMailUser_(body.idToken);
    if (!user) return json_({ status: "auth" });

    switch (body.action) {
      case "mail.state": return json_(mailState_());
      case "mail.saveContacts": return json_(saveContacts_(body.contacts || []));
      case "mail.deleteContacts": return json_(deleteContacts_(body.emails || []));
      case "mail.importContacts": return json_(importContacts_(body.contacts || [], body.status || "active", user));
      case "mail.scan": return json_(scanMailboxStep_(Number(body.days) || 365, Number(body.start) || 0));
      case "mail.saveCampaign": return json_(saveCampaign_(body.campaign || {}, user));
      case "mail.deleteCampaign": return json_(deleteCampaign_(body.id));
      case "mail.preview": return json_({ status: "ok", html: renderEmail_(body.campaign || {}, sampleContact_(body.email)).html, subject: renderSubject_(body.campaign || {}) });
      case "mail.testSend": return json_(testSend_(body.campaign || {}, user));
      case "mail.queueCampaign": return json_(queueCampaign_(body.id, user));
      case "mail.cancelCampaign": return json_(cancelCampaign_(body.id));
      default: return json_({ status: "error", error: "unknown action" });
    }
  } catch (err) {
    console.error(err);
    return json_({ status: "error", error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------- state

function mailState_() {
  var contacts = readTable_(mailSheet_("contacts", CONTACT_COLS), CONTACT_COLS);
  var campaigns = readTable_(mailSheet_("campaigns", CAMPAIGN_COLS), CAMPAIGN_COLS);
  contacts.forEach(function (c) { delete c._row; });
  campaigns.forEach(function (c) { delete c._row; c.id = String(c.id); c.isAd = c.isAd === true || c.isAd === "TRUE"; });
  campaigns.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return {
    status: "ok",
    contacts: contacts,
    campaigns: campaigns,
    quota: MailApp.getRemainingDailyQuota(),
    sender: Session.getEffectiveUser().getEmail()
  };
}

// ---------------------------------------------------------------- contacts

function normEmail_(s) {
  var m = String(s || "").toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/);
  return m ? m[0].replace(/\.+$/, "") : "";
}

function normTags_(t) {
  var arr = Array.isArray(t) ? t : String(t || "").split(/[,،;]/);
  var seen = {};
  return arr.map(function (x) { return String(x).trim(); })
    .filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; })
    .join(", ");
}

// Upsert by email. Fields that are sent replace the stored ones.
function saveContacts_(list) {
  return withLock_(function () {
    var sh = mailSheet_("contacts", CONTACT_COLS);
    var rows = readTable_(sh, CONTACT_COLS);
    var byEmail = {};
    rows.forEach(function (r) { byEmail[normEmail_(r.email)] = r; });
    var toAppend = [], updated = 0;
    list.forEach(function (c) {
      var email = normEmail_(c.email);
      if (!email) return;
      var existing = byEmail[email];
      var merged = Object.assign({}, existing || { addedAt: nowIso_(), source: "manual", status: "active", seenCount: "" }, c);
      merged.email = email;
      merged.tags = normTags_(merged.tags);
      if (existing) {
        sh.getRange(existing._row, 1, 1, CONTACT_COLS.length).setValues([toRow_(merged, CONTACT_COLS)]);
        updated++;
      } else {
        toAppend.push(toRow_(merged, CONTACT_COLS));
        byEmail[email] = merged;
      }
    });
    if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, CONTACT_COLS.length).setValues(toAppend);
    return { status: "ok", added: toAppend.length, updated: updated };
  });
}

function deleteContacts_(emails) {
  return withLock_(function () {
    var sh = mailSheet_("contacts", CONTACT_COLS);
    var set = {};
    emails.forEach(function (e) { set[normEmail_(e)] = true; });
    var rows = readTable_(sh, CONTACT_COLS).filter(function (r) { return set[normEmail_(r.email)]; });
    rows.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { sh.deleteRow(r._row); });
    return { status: "ok", deleted: rows.length };
  });
}

// Import from a pasted list / CSV. Never re-activates someone who unsubscribed
// or bounced; existing contacts only get empty fields filled and tags added.
function importContacts_(list, status, user) {
  return withLock_(function () {
    var sh = mailSheet_("contacts", CONTACT_COLS);
    var rows = readTable_(sh, CONTACT_COLS);
    var byEmail = {};
    rows.forEach(function (r) { byEmail[normEmail_(r.email)] = r; });
    var toAppend = [], updated = 0, skipped = 0;
    list.forEach(function (c) {
      var email = normEmail_(c.email);
      if (!email) { skipped++; return; }
      var ex = byEmail[email];
      if (ex) {
        var changed = false;
        ["name", "company"].forEach(function (k) { if (!ex[k] && c[k]) { ex[k] = c[k]; changed = true; } });
        var tags = normTags_([].concat(String(ex.tags || "").split(","), String(c.tags || "").split(",")));
        if (tags !== ex.tags) { ex.tags = tags; changed = true; }
        if (ex.status === "candidate" && status === "active") { ex.status = "active"; changed = true; }
        if (changed) { sh.getRange(ex._row, 1, 1, CONTACT_COLS.length).setValues([toRow_(ex, CONTACT_COLS)]); updated++; }
        return;
      }
      var row = {
        email: email, name: c.name || "", company: c.company || "", tags: normTags_(c.tags),
        status: status, source: "import:" + user, addedAt: nowIso_(), lastSeen: "", seenCount: "", notes: c.notes || ""
      };
      toAppend.push(toRow_(row, CONTACT_COLS));
      byEmail[email] = row;
    });
    if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, CONTACT_COLS.length).setValues(toAppend);
    return { status: "ok", added: toAppend.length, updated: updated, skipped: skipped };
  });
}

// Addresses found in mail. New ones come in as "candidate" (to be approved in
// the CRM before they get mail). Known ones only get lastSeen/seenCount updated.
function mergeCandidates_(list, source) {
  var sh = mailSheet_("contacts", CONTACT_COLS);
  var rows = readTable_(sh, CONTACT_COLS);
  var byEmail = {};
  rows.forEach(function (r) { byEmail[normEmail_(r.email)] = r; });
  var toAppend = [], updated = 0;
  list.forEach(function (c) {
    var email = normEmail_(c.email);
    if (!email || isExcludedAddress_(email)) return;
    var ex = byEmail[email];
    if (ex) {
      var changed = false;
      if (c.lastSeen && String(c.lastSeen) > String(ex.lastSeen || "")) { ex.lastSeen = c.lastSeen; changed = true; }
      if ((Number(c.count) || 0) > (Number(ex.seenCount) || 0)) { ex.seenCount = Number(c.count); changed = true; }
      if (!ex.name && c.name) { ex.name = c.name; changed = true; }
      if (changed) { sh.getRange(ex._row, 1, 1, CONTACT_COLS.length).setValues([toRow_(ex, CONTACT_COLS)]); updated++; }
      return;
    }
    var row = {
      email: email, name: cleanName_(c.name, email), company: companyFromEmail_(email), tags: "",
      status: "candidate", source: source, addedAt: nowIso_(), lastSeen: c.lastSeen || "",
      seenCount: Number(c.count) || 1, notes: ""
    };
    toAppend.push(toRow_(row, CONTACT_COLS));
    byEmail[email] = row;
  });
  if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, CONTACT_COLS.length).setValues(toAppend);
  return { added: toAppend.length, updated: updated };
}

function isExcludedAddress_(email) {
  var domain = email.split("@")[1] || "";
  var local = email.split("@")[0] || "";
  var inList = function (list) {
    return list.some(function (d) { return domain === d || domain.slice(-(d.length + 1)) === "." + d; });
  };
  if (inList(MAIL_CFG.OWN_DOMAINS) || inList(MAIL_CFG.EXCLUDE_DOMAINS)) return true;
  if (/^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|calendar|newsletter|news|marketing|unsubscribe)([._+-]|$)/.test(local)) return true;
  if (local.length > 40 || /[0-9a-f]{16,}/.test(local)) return true; // generated tracking addresses
  return false;
}

function cleanName_(name, email) {
  var n = String(name || "").replace(/["'<>]/g, "").replace(/\s+/g, " ").trim();
  if (!n || n.indexOf("@") !== -1 || n.toLowerCase() === email) return "";
  return n;
}

function companyFromEmail_(email) {
  var domain = email.split("@")[1] || "";
  if (MAIL_CFG.FREEMAIL_DOMAINS.indexOf(domain) !== -1) return "";
  var parts = domain.split(".");
  // acme.co.il -> acme ; mail.acme.com -> acme
  var skip = { co: 1, com: 1, org: 1, net: 1, ac: 1, gov: 1, il: 1, tr: 1, uk: 1, cn: 1, mail: 1, www: 1 };
  var core = parts.filter(function (p) { return !skip[p] && p.length > 2; });
  return core.length ? core[core.length - 1] : parts[0];
}

// ---------------------------------------------------------------- mailbox scan

// Pulls addresses out of From/To/Cc and out of quoted headers in the body
// ("From: ..." / "מאת: ..."), which is where customers appear in forwarded mail.
function extractAddresses_(str) {
  var out = [];
  var re = /(?:"?([^"<>,;\n]*?)"?\s*<([^<>\s,;]+@[^<>\s,;]+)>)|([A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
  var m;
  while ((m = re.exec(String(str || ""))) !== null) {
    var email = normEmail_(m[2] || m[3]);
    if (email) out.push({ email: email, name: (m[1] || "").replace(/^[\s>*]*(from|to|cc|reply-to|sent by|מאת|אל|עותק|השב אל)\s*:\s*/i, "").trim() });
  }
  return out;
}

function headerLinesFromBody_(body) {
  return String(body || "").split(/\r?\n/).filter(function (l) {
    return /^\s*[>*]*\s*(from|to|cc|reply-to|sent by|מאת|אל|עותק|השב אל)\s*:/i.test(l);
  }).join("\n");
}

function scanThreads_(threads, found) {
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var when = Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), "yyyy-MM-dd");
      var text = [msg.getFrom(), msg.getTo(), msg.getCc(), msg.getReplyTo(), headerLinesFromBody_(msg.getPlainBody())].join("\n");
      var seenInMsg = {};
      extractAddresses_(text).forEach(function (a) {
        if (seenInMsg[a.email]) return;
        seenInMsg[a.email] = true;
        if (isExcludedAddress_(a.email)) return;
        var f = found[a.email] || (found[a.email] = { email: a.email, name: "", count: 0, lastSeen: "" });
        f.count++;
        if (!f.name && a.name) f.name = a.name;
        if (when > f.lastSeen) f.lastSeen = when;
      });
    });
  });
}

// One step of a manual scan from the CRM page. The page calls it again with
// nextStart until done, so a large mailbox never hits the 6-minute limit.
function scanMailboxStep_(days, start) {
  var t0 = Date.now();
  var query = "newer_than:" + days + "d -in:chats -in:spam -in:trash";
  var found = {};
  var scanned = 0, done = false;
  while (Date.now() - t0 < MAIL_CFG.SCAN_TIME_BUDGET_MS) {
    var threads = GmailApp.search(query, start, 100);
    if (!threads.length) { done = true; break; }
    scanThreads_(threads, found);
    scanned += threads.length;
    start += threads.length;
    if (threads.length < 100) { done = true; break; }
  }
  var list = Object.keys(found).map(function (k) { return found[k]; });
  var r = withLock_(function () { return mergeCandidates_(list, "gmail:" + Session.getEffectiveUser().getEmail()); });
  return { status: "ok", scanned: scanned, added: r.added, updated: r.updated, done: done, nextStart: start };
}

// Time trigger: picks up new addresses from the last 2 days.
function scanMailboxDaily() {
  var found = {};
  var start = 0;
  while (true) {
    var threads = GmailApp.search("newer_than:2d -in:chats -in:spam -in:trash", start, 100);
    if (!threads.length) break;
    scanThreads_(threads, found);
    start += threads.length;
    if (threads.length < 100) break;
  }
  var list = Object.keys(found).map(function (k) { return found[k]; });
  withLock_(function () { mergeCandidates_(list, "gmail:" + Session.getEffectiveUser().getEmail()); });
}

// ---------------------------------------------------------------- campaigns

function saveCampaign_(c, user) {
  return withLock_(function () {
    var sh = mailSheet_("campaigns", CAMPAIGN_COLS);
    var rows = readTable_(sh, CAMPAIGN_COLS);
    var ex = c.id ? rows.filter(function (r) { return String(r.id) === String(c.id); })[0] : null;
    if (ex && ex.status !== "draft") return { status: "error", error: "אפשר לערוך רק טיוטה" };
    var row = {
      id: ex ? String(ex.id) : String(Date.now()),
      subject: c.subject || "", body: c.body || "", format: c.format === "html" ? "html" : "text",
      type: c.type || "marketing", isAd: !!c.isAd, tags: normTags_(c.tags),
      status: "draft", createdBy: ex ? ex.createdBy : user, createdAt: ex ? ex.createdAt : nowIso_(),
      total: "", sent: "", failed: "", finishedAt: ""
    };
    if (ex) sh.getRange(ex._row, 1, 1, CAMPAIGN_COLS.length).setValues([toRow_(row, CAMPAIGN_COLS)]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, CAMPAIGN_COLS.length).setValues([toRow_(row, CAMPAIGN_COLS)]);
    return { status: "ok", id: row.id };
  });
}

function deleteCampaign_(id) {
  return withLock_(function () {
    var sh = mailSheet_("campaigns", CAMPAIGN_COLS);
    var ex = readTable_(sh, CAMPAIGN_COLS).filter(function (r) { return String(r.id) === String(id); })[0];
    if (!ex) return { status: "ok" };
    if (ex.status !== "draft") return { status: "error", error: "אפשר למחוק רק טיוטה" };
    sh.deleteRow(ex._row);
    return { status: "ok" };
  });
}

function audience_(contacts, tags) {
  var want = normTags_(tags).split(", ").filter(Boolean);
  var seen = {};
  return contacts.filter(function (c) {
    var email = normEmail_(c.email);
    if (!email || seen[email] || c.status !== "active") return false;
    if (want.length) {
      var has = String(c.tags || "").split(",").map(function (x) { return x.trim(); });
      if (!want.some(function (t) { return has.indexOf(t) !== -1; })) return false;
    }
    seen[email] = true;
    return true;
  });
}

function queueCampaign_(id, user) {
  var res = withLock_(function () {
    var csh = mailSheet_("campaigns", CAMPAIGN_COLS);
    var camp = readTable_(csh, CAMPAIGN_COLS).filter(function (r) { return String(r.id) === String(id); })[0];
    if (!camp) return { status: "error", error: "הקמפיין לא נמצא" };
    if (camp.status !== "draft") return { status: "error", error: "הקמפיין כבר נשלח" };
    if (!String(camp.subject).trim() || !String(camp.body).trim()) return { status: "error", error: "חסר נושא או תוכן" };

    var contacts = readTable_(mailSheet_("contacts", CONTACT_COLS), CONTACT_COLS);
    var recipients = audience_(contacts, camp.tags);
    if (!recipients.length) return { status: "error", error: "אין נמענים פעילים בקהל שנבחר" };

    var lsh = mailSheet_("sendlog", LOG_COLS);
    var rows = recipients.map(function (c) { return [String(camp.id), normEmail_(c.email), "pending", "", ""]; });
    lsh.getRange(lsh.getLastRow() + 1, 1, rows.length, LOG_COLS.length).setValues(rows);

    camp.status = "sending"; camp.total = rows.length; camp.sent = 0; camp.failed = 0;
    csh.getRange(camp._row, 1, 1, CAMPAIGN_COLS.length).setValues([toRow_(camp, CAMPAIGN_COLS)]);
    return { status: "ok", total: rows.length };
  });
  return res; // the 5-minute trigger (processMailQueue) starts sending
}

function cancelCampaign_(id) {
  return withLock_(function () {
    var csh = mailSheet_("campaigns", CAMPAIGN_COLS);
    var camp = readTable_(csh, CAMPAIGN_COLS).filter(function (r) { return String(r.id) === String(id); })[0];
    if (!camp || camp.status !== "sending") return { status: "error", error: "הקמפיין לא בשליחה" };
    camp.status = "cancelled"; camp.finishedAt = nowIso_();
    csh.getRange(camp._row, 1, 1, CAMPAIGN_COLS.length).setValues([toRow_(camp, CAMPAIGN_COLS)]);
    return { status: "ok" };
  });
}

// ---------------------------------------------------------------- rendering

function escHtml_(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mergeFields_(text, contact, escape) {
  var esc = escape ? escHtml_ : function (x) { return String(x || ""); };
  var name = String(contact.name || "").trim();
  var first = name.split(/\s+/)[0] || "";
  return String(text || "")
    .replace(/\{\{\s*(name|שם)\s*\}\}/gi, esc(name))
    .replace(/\{\{\s*(first|שם פרטי)\s*\}\}/gi, esc(first))
    .replace(/\{\{\s*(company|חברה)\s*\}\}/gi, esc(contact.company || ""))
    .replace(/\{\{\s*(email|מייל)\s*\}\}/gi, esc(contact.email || ""));
}

// Simple text format: blank line = new paragraph, "- " = bullet,
// **bold**, links become clickable, "## " = heading.
function textToHtml_(text) {
  var blocks = String(text || "").replace(/\r/g, "").split(/\n\s*\n/);
  var inline = function (s) {
    return escHtml_(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:' + MAIL_CFG.BRAND_COLOR + '">$1</a>')
      .replace(/\n/g, "<br>");
  };
  return blocks.map(function (b) {
    var lines = b.split("\n");
    if (lines.every(function (l) { return /^\s*[-•*]\s+/.test(l); })) {
      return '<ul style="margin:0 0 16px;padding-right:20px">' + lines.map(function (l) {
        return '<li style="margin-bottom:4px">' + inline(l.replace(/^\s*[-•*]\s+/, "")) + "</li>";
      }).join("") + "</ul>";
    }
    if (/^##\s+/.test(b)) {
      return '<h2 style="font-size:19px;margin:0 0 12px;color:' + MAIL_CFG.BRAND_COLOR + '">' + inline(b.replace(/^##\s+/, "")) + "</h2>";
    }
    return '<p style="margin:0 0 16px">' + inline(b) + "</p>";
  }).join("\n");
}

function unsubscribeUrl_(email) {
  return MAIL_CFG.WEBAPP_URL + "?action=unsubscribe&e=" + encodeURIComponent(email) + "&t=" + unsubToken_(email);
}

function unsubToken_(email) {
  var sig = Utilities.computeHmacSha256Signature(normEmail_(email), mailSecret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, "").slice(0, 24);
}

function renderSubject_(camp) {
  var s = String(camp.subject || "").trim();
  if (camp.isAd && !/^פרסומת/.test(s)) s = "פרסומת: " + s;
  return s;
}

function renderEmail_(camp, contact) {
  var bodyText = mergeFields_(camp.body, contact, false);
  var inner = camp.format === "html" ? mergeFields_(camp.body, contact, true) : textToHtml_(bodyText);
  var unsub = unsubscribeUrl_(contact.email || "preview@example.com");
  var footer = MAIL_CFG.FOOTER_LINES.map(escHtml_).join("<br>");
  var html =
    '<div dir="rtl" style="background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" align="center" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">' +
    '<tr><td style="background:' + MAIL_CFG.BRAND_COLOR + ';color:#ffffff;padding:18px 28px;font-size:20px;font-weight:bold;text-align:right">' + escHtml_(MAIL_CFG.SENDER_NAME) + "</td></tr>" +
    '<tr><td dir="rtl" style="padding:28px;font-size:15px;line-height:1.65;color:#0f172a;text-align:right">' + inner + "</td></tr>" +
    '<tr><td style="padding:18px 28px;background:#f8fafc;font-size:12px;line-height:1.6;color:#64748b;text-align:right;border-top:1px solid #e2e8f0">' + footer +
    '<br><a href="' + unsub + '" style="color:#64748b">להסרה מרשימת התפוצה לחצו כאן</a></td></tr>' +
    "</table></div>";
  var plain = (camp.format === "html" ? String(inner).replace(/<[^>]+>/g, " ") : bodyText) +
    "\n\n--\n" + MAIL_CFG.FOOTER_LINES.join("\n") + "\nלהסרה מרשימת התפוצה: " + unsub;
  return { html: html, plain: plain, unsub: unsub };
}

function sampleContact_(email) {
  var c = null;
  if (email) {
    c = readTable_(mailSheet_("contacts", CONTACT_COLS), CONTACT_COLS)
      .filter(function (r) { return normEmail_(r.email) === normEmail_(email); })[0];
  }
  return c || { email: "customer@example.com", name: "ישראל ישראלי", company: "לקוח לדוגמה בע\"מ" };
}

function sendOne_(camp, contact) {
  var r = renderEmail_(camp, contact);
  var opts = { htmlBody: r.html, name: MAIL_CFG.SENDER_NAME };
  if (MAIL_CFG.REPLY_TO) opts.replyTo = MAIL_CFG.REPLY_TO;
  if (MAIL_CFG.FROM_ALIAS) opts.from = MAIL_CFG.FROM_ALIAS;
  GmailApp.sendEmail(normEmail_(contact.email), renderSubject_(camp), r.plain, opts);
}

function testSend_(camp, user) {
  var contact = Object.assign({}, sampleContact_(null), { email: user });
  var t = Object.assign({}, camp, { subject: "[ניסיון] " + (camp.subject || "") });
  sendOne_(t, contact);
  return { status: "ok", to: user };
}

// ---------------------------------------------------------------- send queue

// Time trigger, every 5 minutes. Sends the next batch of the oldest campaign in progress.
function processMailQueue() {
  var props = PropertiesService.getScriptProperties();
  var busyUntil = Number(props.getProperty("MAIL_BUSY_UNTIL") || 0);
  if (busyUntil > Date.now()) return;
  props.setProperty("MAIL_BUSY_UNTIL", String(Date.now() + 6 * 60 * 1000));
  try {
    try { processBounces_(); } catch (e) { console.error("bounces: " + e); }

    var campaigns = readTable_(mailSheet_("campaigns", CAMPAIGN_COLS), CAMPAIGN_COLS)
      .filter(function (c) { return c.status === "sending"; })
      .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
    if (!campaigns.length) return;
    var camp = campaigns[0];
    camp.isAd = camp.isAd === true || camp.isAd === "TRUE";

    var quota = MailApp.getRemainingDailyQuota();
    if (quota <= 5) return; // keep a little for people's own mail; continues tomorrow

    var lsh = mailSheet_("sendlog", LOG_COLS);
    var pending = readTable_(lsh, LOG_COLS).filter(function (l) {
      return String(l.campaignId) === String(camp.id) && l.status === "pending";
    });

    var contacts = readTable_(mailSheet_("contacts", CONTACT_COLS), CONTACT_COLS);
    var byEmail = {};
    contacts.forEach(function (c) { byEmail[normEmail_(c.email)] = c; });

    var batch = pending.slice(0, Math.min(MAIL_CFG.BATCH_SIZE, quota - 5));
    var t0 = Date.now(), results = [];
    for (var i = 0; i < batch.length; i++) {
      if (Date.now() - t0 > MAIL_CFG.SEND_TIME_BUDGET_MS) break;
      var l = batch[i];
      var c = byEmail[normEmail_(l.email)];
      if (!c || c.status !== "active") { results.push({ row: l._row, status: "skipped", error: c ? c.status : "deleted" }); continue; }
      try {
        sendOne_(camp, c);
        results.push({ row: l._row, status: "sent", error: "" });
      } catch (err) {
        results.push({ row: l._row, status: "failed", error: String(err && err.message || err).slice(0, 300) });
        if (/limit|quota|too many/i.test(String(err))) break;
      }
    }

    withLock_(function () {
      var at = nowIso_();
      results.forEach(function (r) { lsh.getRange(r.row, 3, 1, 3).setValues([[r.status, at, r.error]]); });
      var csh = mailSheet_("campaigns", CAMPAIGN_COLS);
      var fresh = readTable_(csh, CAMPAIGN_COLS).filter(function (r) { return String(r.id) === String(camp.id); })[0];
      if (!fresh) return;
      var logs = readTable_(lsh, LOG_COLS).filter(function (r) { return String(r.campaignId) === String(camp.id); });
      fresh.sent = logs.filter(function (r) { return r.status === "sent"; }).length;
      fresh.failed = logs.filter(function (r) { return r.status === "failed"; }).length;
      var left = logs.filter(function (r) { return r.status === "pending"; }).length;
      if (fresh.status === "sending" && left === 0) { fresh.status = "done"; fresh.finishedAt = at; }
      csh.getRange(fresh._row, 1, 1, CAMPAIGN_COLS.length).setValues([toRow_(fresh, CAMPAIGN_COLS)]);
    });
  } finally {
    props.deleteProperty("MAIL_BUSY_UNTIL");
  }
}

// Marks contacts whose mail bounced (from "Mail Delivery Subsystem" replies).
function processBounces_() {
  var LABEL = "Mail-Bounce-Processed";
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search("from:mailer-daemon newer_than:7d -label:" + LABEL, 0, 50);
  if (!threads.length) return;
  var bounced = {};
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      var body = m.getPlainBody() || "";
      var re = /(?:Final-Recipient:\s*rfc822;\s*|wasn't delivered to\s+|couldn't be delivered to\s+|delivery to the following recipient[s]? failed[^\n]*\n\s*)([A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/gi;
      var mm;
      while ((mm = re.exec(body)) !== null) bounced[normEmail_(mm[1])] = true;
    });
    t.addLabel(label);
  });
  var emails = Object.keys(bounced);
  if (!emails.length) return;
  withLock_(function () {
    var sh = mailSheet_("contacts", CONTACT_COLS);
    readTable_(sh, CONTACT_COLS).forEach(function (r) {
      if (bounced[normEmail_(r.email)] && r.status === "active") {
        sh.getRange(r._row, 5).setValue("bounced");
      }
    });
  });
}

// ---------------------------------------------------------------- unsubscribe
// The link opens a page with a button. Removal happens only on the click, so
// mail security scanners that open links in advance don't unsubscribe anyone.

function unsubscribePage_(email, token) {
  var valid = email && token && token === unsubToken_(email);
  var html =
    '<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:40px 16px;color:#0f172a}' +
    '.card{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;text-align:center;box-shadow:0 2px 10px #0001}' +
    'button{background:' + MAIL_CFG.BRAND_COLOR + ';color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:16px;cursor:pointer}</style></head><body><div class="card">' +
    '<h2 style="margin-top:0">' + escHtml_(MAIL_CFG.SENDER_NAME) + "</h2>" +
    (valid
      ? '<p id="msg">להסיר את <b>' + escHtml_(email) + '</b> מרשימת התפוצה?</p><button id="btn">הסרה מרשימת התפוצה</button>' +
        "<script>document.getElementById('btn').onclick=function(){this.disabled=true;" +
        "google.script.run.withSuccessHandler(function(ok){document.getElementById('msg').innerHTML=ok?'הוסרת מרשימת התפוצה. לא יישלחו אליך יותר דיוורים.':'משהו השתבש. אפשר להשיב למייל ולבקש הסרה.';document.getElementById('btn').style.display='none';})" +
        ".confirmUnsubscribe(" + JSON.stringify(String(email)) + "," + JSON.stringify(String(token)) + ");};</script>"
      : "<p>הקישור אינו תקין. להסרה אפשר להשיב למייל שקיבלתם ולבקש הסרה.</p>") +
    "</div></body></html>";
  return HtmlService.createHtmlOutput(html).setTitle("הסרה מרשימת התפוצה")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// Called from the unsubscribe page (google.script.run).
function confirmUnsubscribe(email, token) {
  if (!email || !token || token !== unsubToken_(email)) return false;
  var target = normEmail_(email);
  return withLock_(function () {
    var sh = mailSheet_("contacts", CONTACT_COLS);
    var rows = readTable_(sh, CONTACT_COLS).filter(function (r) { return normEmail_(r.email) === target; });
    if (!rows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, 1, CONTACT_COLS.length).setValues([toRow_({
        email: target, status: "unsubscribed", source: "unsubscribe", addedAt: nowIso_(), notes: "הוסר ב-" + nowIso_()
      }, CONTACT_COLS)]);
    }
    rows.forEach(function (r) {
      sh.getRange(r._row, 5).setValue("unsubscribed");
      sh.getRange(r._row, 10).setValue(((r.notes ? r.notes + " | " : "") + "הוסר ב-" + nowIso_()));
    });
    return true;
  });
}

// Run once by hand if the web app answers "You do not have permission to call
// UrlFetchApp.fetch": it asks Google for every permission the mailing module uses.
function authorizeMailing() {
  UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=x", { muteHttpExceptions: true });
  console.log("Running as: " + Session.getEffectiveUser().getEmail());
  console.log("Mail quota left today: " + MailApp.getRemainingDailyQuota());
  console.log("Triggers: " + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(", "));
}
