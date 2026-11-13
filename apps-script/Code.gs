// Apps Script for the quotes CRM (script.google.com project).
// Project ID: 1lIYe8fpH5gfq9Tqribrdtv8jFwOt9WBWWE01rYbhaOm93vlwHWjySrD0
// Runs on the rfq@alpha-lg.com mailbox.
//
// 2026-11-12: saving from the web page no longer rewrites the whole sheet.
// The page sends only the rows that changed ("upsert") and the ids it
// deleted ("deleteIds"), and the script updates just those rows, under a lock.
// Before this, every save wiped and rewrote the sheet from the browser's copy,
// so any RFQ that processRfqEmails added after the page was opened was erased
// by the next save. backfillMissingRfqs() brings those RFQs back from the mailbox.

var ADMIN_EMAILS = ["yoav@alpha-lg.com", "einatb@alpha-lg.com"];
var SHEET_ID = "1aVEZoHxEz7_dTUkO46Kqco177T_Hhv2WOhcKDlajHEY";
var NUM_COLS = 11;
// Columns (1-based): 1 id, 2 client, 3 topic, 4 status, 5 suppliers, 6 notes,
// 7 date, 8 owner, 9 quoteNumber, 10 salesNotes, 11 reminderAt

function getSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName("quotes") || ss.getSheets()[0];
}

function isAdmin_(email) {
  return ADMIN_EMAILS.indexOf((email || "").toLowerCase()) !== -1;
}

function formatDate_(v, pattern) {
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), pattern) : (v || "");
}

function rowToQuote_(row) {
  return {
    id: row[0],
    client: row[1],
    topic: row[2],
    status: row[3],
    suppliers: row[4] ? String(row[4]).split(", ") : [],
    notes: row[5] || "",
    date: formatDate_(row[6], "yyyy-MM-dd"),
    owner: row[7] || "",
    quoteNumber: row[8] || "",
    salesNotes: row[9] || "",
    reminderAt: formatDate_(row[10], "yyyy-MM-dd'T'HH:mm")
  };
}

function quoteToRow_(q, owner) {
  return [
    q.id, q.client || "", q.topic || "", q.status || "",
    Array.isArray(q.suppliers) ? q.suppliers.join(", ") : (q.suppliers || ""),
    q.notes || "", q.date || "", owner || "", q.quoteNumber || "", q.salesNotes || "", q.reminderAt || ""
  ];
}

function doGet(e) {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var quotes = [];
  if (lastRow > 1) {
    quotes = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues()
      .filter(function (row) { return row[0] !== ""; })
      .map(rowToQuote_);
  }

  var email = (e.parameter.email || "").toLowerCase();
  if (isAdmin_(email)) {
    // admins see everything
  } else if (email) {
    quotes = quotes.filter(function (q) { return (q.owner || "").toLowerCase() === email; });
  } else {
    quotes = [];
  }

  return ContentService
    .createTextOutput(JSON.stringify({ quotes: quotes }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Body: { email, upsert: [quote, ...], deleteIds: [id, ...] }
// Older cached pages still send { email, quotes: [all quotes] }: those rows are
// upserted and nothing is deleted, so a stale page can never erase rows.
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    var email = (body.email || "").toLowerCase();
    if (!email) return json_({ status: "error", error: "no email" });
    var admin = isAdmin_(email);

    var upserts = body.upsert || body.quotes || [];
    var isNewFormat = body.upsert !== undefined || body.deleteIds !== undefined;
    var deleteIds = isNewFormat ? (body.deleteIds || []) : [];

    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    var values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues() : [];
    var indexById = {};
    values.forEach(function (row, i) { if (row[0] !== "") indexById[String(row[0])] = i; });

    var updated = 0, added = 0, deleted = 0, skipped = 0;
    var toAppend = [];

    upserts.forEach(function (q) {
      if (!q || q.id === undefined || q.id === "") return;
      var i = indexById[String(q.id)];
      if (i !== undefined) {
        var owner = String(values[i][7] || "").toLowerCase();
        if (!admin && owner !== email) { skipped++; return; }
        var row = quoteToRow_(q, values[i][7] || email);
        if (JSON.stringify(row.map(String)) === JSON.stringify(values[i].map(String))) return;
        sheet.getRange(i + 2, 1, 1, NUM_COLS).setValues([row]);
        values[i] = row;
        updated++;
      } else {
        var newOwner = admin && q.owner ? q.owner : email;
        toAppend.push(quoteToRow_(q, newOwner));
        indexById[String(q.id)] = -1;
        added++;
      }
    });

    if (toAppend.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, NUM_COLS).setValues(toAppend);
    }

    // Delete from the bottom up so row numbers stay valid.
    var rowsToDelete = [];
    deleteIds.forEach(function (id) {
      var i = indexById[String(id)];
      if (i === undefined || i < 0) return;
      var owner = String(values[i][7] || "").toLowerCase();
      if (!admin && owner !== email) { skipped++; return; }
      rowsToDelete.push(i + 2);
    });
    rowsToDelete.sort(function (a, b) { return b - a; }).forEach(function (r) {
      sheet.deleteRow(r);
      deleted++;
    });

    return json_({ status: "ok", updated: updated, added: added, deleted: deleted, skipped: skipped });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Runs on a time trigger: adds a row for every new RFQ email from alpha-lg.com.
function processRfqEmails() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return;
  }
  try {
    var LABEL_NAME = "RFQ-Processed";
    var UNRECOGNIZED_LABEL_NAME = "RFQ-Unrecognized";
    var label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
    var unrecognizedLabel = GmailApp.getUserLabelByName(UNRECOGNIZED_LABEL_NAME) || GmailApp.createLabel(UNRECOGNIZED_LABEL_NAME);

    var query = 'from:alpha-lg.com -label:' + LABEL_NAME + ' -label:' + UNRECOGNIZED_LABEL_NAME;
    var threads = GmailApp.search(query, 0, 50);
    addRfqRowsFromThreads_(threads, "", function (thread, matchedAny) {
      thread.addLabel(matchedAny ? label : unrecognizedLabel);
    });
  } finally {
    lock.releaseLock();
  }
}

// Run once by hand (Run > backfillMissingRfqs) after deploying this version.
// Goes over RFQ emails of the last DAYS days, labelled or not, and adds a row
// for every RFQ number that is not in the sheet. Rows it adds are marked in
// salesNotes so their real status can be set by hand.
function backfillMissingRfqs() {
  var DAYS = 90;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // No subject:RFQ filter: Gmail treats "RFQ487" as one word, so it would miss it.
    // The RFQ number is matched in code below.
    var query = 'from:alpha-lg.com newer_than:' + DAYS + 'd';
    var start = 0, total = 0;
    while (true) {
      var threads = GmailApp.search(query, start, 100);
      if (!threads.length) break;
      total += addRfqRowsFromThreads_(threads, "שוחזר מהמייל ב-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy") + " – לעדכן סטטוס", null);
      start += threads.length;
      if (threads.length < 100) break;
    }
    console.log("backfillMissingRfqs added " + total + " rows");
  } finally {
    lock.releaseLock();
  }
}

// Adds one row per RFQ number found in the threads' subjects that is not in the
// sheet yet. Uses the date of the first email that carries that RFQ number.
function addRfqRowsFromThreads_(threads, salesNote, onThread) {
  var sheet = getSheet_();
  var existingRfqs = {};
  var lastExisting = sheet.getLastRow();
  if (lastExisting > 1) {
    sheet.getRange(2, 9, lastExisting - 1, 1).getValues().forEach(function (r) {
      var key = String(r[0] || "").replace(/\s+/g, "").toUpperCase();
      if (key) existingRfqs[key] = true;
    });
  }

  var rowsToAdd = [];
  threads.forEach(function (thread) {
    var matchedAny = false;
    thread.getMessages().forEach(function (msg) {
      var subject = msg.getSubject() || "";
      var rfqMatch = subject.match(/RFQ\s*(\d+)(?!\d|\s*[x×'’"]|\s*(ft|feet)\b)/i); // ignore '1x20', '40’', '40ft'
      if (!rfqMatch) return;
      matchedAny = true;

      var quoteNumber = "RFQ" + rfqMatch[1];
      var key = quoteNumber.toUpperCase();
      if (existingRfqs[key]) return;

      var fromRaw = msg.getFrom();
      var emailMatch = fromRaw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      var senderEmail = emailMatch ? emailMatch[0].toLowerCase() : fromRaw.toLowerCase();
      // The owner is whoever at Alpha sent it; replies from agents (e.g. msc.com) don't open a row.
      if (!/@alpha-lg\.com$/.test(senderEmail)) return;
      existingRfqs[key] = true;

      var cleanSubject = subject.replace(/^\s*((re|fw|fwd|השב|העבר)\s*:\s*)+/i, "");
      var client = extractClient(cleanSubject);
      var topic = cleanSubject.replace(/RFQ\s*\d+/i, "").replace(/^[\s.\-:,]+/, "").trim();
      var notes = (msg.getPlainBody() || "").trim().slice(0, 2000);
      var dateStr = Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), "yyyy-MM-dd");

      rowsToAdd.push([
        Date.now() + Math.floor(Math.random() * 100000),
        client, topic, "waiting_supplier", "", notes, dateStr,
        senderEmail, quoteNumber, salesNote || "", ""
      ]);
    });
    if (onThread) onThread(thread, matchedAny);
  });

  if (rowsToAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, NUM_COLS).setValues(rowsToAdd);
  }
  return rowsToAdd.length;
}

function extractClient(subject) {
  var cIdx = subject.indexOf("C/");
  if (cIdx !== -1) {
    var rest = subject.slice(cIdx + 2).replace(/^\s+/, "");
    var spaceIdx = rest.search(/[\s\/]/);
    return (spaceIdx !== -1 ? rest.slice(0, spaceIdx) : rest).trim();
  }
  var slashIdx2 = subject.indexOf("/");
  if (slashIdx2 !== -1) return subject.slice(0, slashIdx2).trim();
  return subject.trim();
}
