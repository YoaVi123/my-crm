// Contact scanner for a personal mailbox (yoav@, a salesperson's mailbox, ...).
//
// This is a SEPARATE Apps Script project, not part of the CRM project:
//   1. Signed in as the mailbox owner, open script.google.com > New project,
//      paste this file, and fill SCANNER_KEY (setupMailing() in the CRM
//      project prints it in the log).
//   2. Run scanMyMailbox() once. It goes over the last DAYS days and sends
//      every outside address it finds to the CRM as "ממתין לאישור".
//      If it stops at the 6-minute limit, just run it again: it continues
//      where it stopped.
//   3. Optional: Triggers > Add trigger > scanRecent, daily, to keep adding
//      new addresses from now on.
// Nothing is sent to anyone; addresses only reach the CRM list for approval.

var SCANNER_CFG = {
  WEBAPP_URL: "https://script.google.com/macros/s/AKfycbxAm88pe-7sN81UQYSfdCdQ5gKJdaSyf0IbOnuXHjCBTP8Z-e-w108KVeiQ0jWRZflPnQ/exec",
  SCANNER_KEY: "PASTE_KEY_HERE",
  DAYS: 730,
  OWN_DOMAINS: ["alpha-lg.com"],
  EXCLUDE_DOMAINS: [
    "msc.com", "zim.com", "one-line.com", "oocl.com", "evergreen-line.com", "evergreen-shipping.co.il",
    "maersk.com", "cma-cgm.com", "hlag.com", "coscon.com", "cosco.com", "yangming.com",
    "google.com", "googlegroups.com", "facebookmail.com", "linkedin.com"
  ]
};

function scanMyMailbox() {
  var props = PropertiesService.getUserProperties();
  var start = Number(props.getProperty("SCAN_START") || 0);
  var done = scan_("newer_than:" + SCANNER_CFG.DAYS + "d -in:chats -in:spam -in:trash", start, function (next) {
    props.setProperty("SCAN_START", String(next));
  });
  if (done) {
    props.deleteProperty("SCAN_START");
    console.log("Scan finished.");
  } else {
    console.log("Stopped before the time limit. Run scanMyMailbox() again to continue.");
  }
}

function scanRecent() {
  scan_("newer_than:2d -in:chats -in:spam -in:trash", 0, null);
}

function scan_(query, start, saveProgress) {
  var t0 = Date.now();
  var found = {};
  var done = false;
  while (Date.now() - t0 < 4.5 * 60 * 1000) {
    var threads = GmailApp.search(query, start, 100);
    if (!threads.length) { done = true; break; }
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (msg) {
        var when = Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), "yyyy-MM-dd");
        var text = [msg.getFrom(), msg.getTo(), msg.getCc(), msg.getReplyTo(), headerLines_(msg.getPlainBody())].join("\n");
        var seen = {};
        addresses_(text).forEach(function (a) {
          if (seen[a.email] || excluded_(a.email)) return;
          seen[a.email] = true;
          var f = found[a.email] || (found[a.email] = { email: a.email, name: "", count: 0, lastSeen: "" });
          f.count++;
          if (!f.name && a.name) f.name = a.name;
          if (when > f.lastSeen) f.lastSeen = when;
        });
      });
    });
    start += threads.length;
    if (threads.length < 100) { done = true; break; }
  }
  send_(Object.keys(found).map(function (k) { return found[k]; }));
  if (saveProgress) saveProgress(start);
  return done;
}

function send_(list) {
  var source = "gmail:" + Session.getActiveUser().getEmail();
  for (var i = 0; i < list.length; i += 400) {
    var res = UrlFetchApp.fetch(SCANNER_CFG.WEBAPP_URL, {
      method: "post",
      contentType: "text/plain;charset=utf-8",
      payload: JSON.stringify({ action: "mail.addCandidates", key: SCANNER_CFG.SCANNER_KEY, source: source, contacts: list.slice(i, i + 400) }),
      muteHttpExceptions: true,
      followRedirects: true
    });
    var body = res.getContentText();
    if (body.indexOf('"status":"ok"') === -1) throw new Error("CRM rejected the list: " + body.slice(0, 200));
    console.log("Sent " + Math.min(400, list.length - i) + " addresses: " + body);
  }
}

function headerLines_(body) {
  return String(body || "").split(/\r?\n/).filter(function (l) {
    return /^\s*[>*]*\s*(from|to|cc|reply-to|sent by|מאת|אל|עותק|השב אל)\s*:/i.test(l);
  }).join("\n");
}

function addresses_(str) {
  var out = [];
  var re = /(?:"?([^"<>,;\n]*?)"?\s*<([^<>\s,;]+@[^<>\s,;]+)>)|([A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
  var m;
  while ((m = re.exec(String(str || ""))) !== null) {
    var raw = String(m[2] || m[3]).toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/);
    if (raw) out.push({ email: raw[0].replace(/\.+$/, ""), name: (m[1] || "").replace(/^[\s>*]*(from|to|cc|reply-to|sent by|מאת|אל|עותק|השב אל)\s*:\s*/i, "").trim() });
  }
  return out;
}

function excluded_(email) {
  var domain = email.split("@")[1] || "";
  var local = email.split("@")[0] || "";
  var inList = function (list) {
    return list.some(function (d) { return domain === d || domain.slice(-(d.length + 1)) === "." + d; });
  };
  if (inList(SCANNER_CFG.OWN_DOMAINS) || inList(SCANNER_CFG.EXCLUDE_DOMAINS)) return true;
  if (/^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|calendar|newsletter|news|marketing|unsubscribe)([._+-]|$)/.test(local)) return true;
  if (local.length > 40 || /[0-9a-f]{16,}/.test(local)) return true;
  return false;
}
