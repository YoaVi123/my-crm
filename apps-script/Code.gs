// Backup of Apps Script Code.gs from script.google.com project
// Project ID: 1lIYe8fpH5gfq9Tqribrdtv8jFwOt9WBWWE01rYbhaOm93vlwHWjySrD0
// Owner account: yoav@alpha-lg.com
// Backed up: 2026-10-07

var ADMIN_EMAIL = "yoav@alpha-lg.com";
var SHEET_ID = "1aVEZoHxEz7_dTUkO46Kqco177T_Hhv2WOhcKDlajHEY";
var NUM_COLS = 9;

function doGet(e) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName("quotes") || ss.getSheets()[0];
  var lastRow = sheet.getLastRow();
  var quotes = [];
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
    quotes = data
      .filter(function(row) { return row[0] !== ""; })
      .map(function(row) {
        return {
          id: row[0],
          client: row[1],
          topic: row[2],
          status: row[3],
          suppliers: row[4] ? row[4].split(", ") : [],
          notes: row[5] || "",
          date: (row[6] instanceof Date ? Utilities.formatDate(row[6], Session.getScriptTimeZone(), "yyyy-MM-dd") : row[6]) || "",
          owner: row[7] || "",
          quoteNumber: row[8] || ""
        };
      });
  }

  var email = (e.parameter.email || "").toLowerCase();
  if (email === ADMIN_EMAIL) {
    // admin sees everything
  } else if (email) {
    quotes = quotes.filter(function(q) { return (q.owner || "").toLowerCase() === email; });
  } else {
    quotes = [];
  }

  return ContentService
    .createTextOutput(JSON.stringify({ quotes: quotes }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName("quotes") || ss.getSheets()[0];

  var body = JSON.parse(e.postData.contents);
  var incoming = body.quotes || [];
  var email = (body.email || "").toLowerCase();

  var lastRow = sheet.getLastRow();
  var existing = [];
  if (lastRow > 1) {
    existing = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues()
      .filter(function(row) { return row[0] !== ""; });
  }

  var finalRows;
  if (email === ADMIN_EMAIL) {
    finalRows = incoming.map(function(q) {
      return [
        q.id, q.client || "", q.topic || "", q.status || "",
        Array.isArray(q.suppliers) ? q.suppliers.join(", ") : (q.suppliers || ""),
        q.notes || "", q.date || "", q.owner || email, q.quoteNumber || ""
      ];
    });
  } else {
    var others = existing.filter(function(row) { return (row[7] || "").toLowerCase() !== email; });
    var mine = incoming.map(function(q) {
      return [
        q.id, q.client || "", q.topic || "", q.status || "",
        Array.isArray(q.suppliers) ? q.suppliers.join(", ") : (q.suppliers || ""),
        q.notes || "", q.date || "", email, q.quoteNumber || ""
      ];
    });
    finalRows = others.concat(mine);
  }

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, NUM_COLS).clearContent();
  }
  if (finalRows.length > 0) {
    sheet.getRange(2, 1, finalRows.length, NUM_COLS).setValues(finalRows);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", count: finalRows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}

function processRfqEmails() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return;
  }
  try {

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName("quotes") || ss.getSheets()[0];
  var LABEL_NAME = "RFQ-Processed";
  var label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
  var UNRECOGNIZED_LABEL_NAME = "RFQ-Unrecognized";
  var unrecognizedLabel = GmailApp.getUserLabelByName(UNRECOGNIZED_LABEL_NAME) || GmailApp.createLabel(UNRECOGNIZED_LABEL_NAME);

  var query = 'from:alpha-lg.com -label:' + LABEL_NAME + ' -label:' + UNRECOGNIZED_LABEL_NAME;
  var threads = GmailApp.search(query, 0, 50);

  var rowsToAdd = [];

  // Collect RFQ numbers that already exist in the sheet, so replies
  // (Re:/Fwd:) with the same RFQ number never open a duplicate row.
  var existingRfqs = {};
  var lastExisting = sheet.getLastRow();
  if (lastExisting > 1) {
    sheet.getRange(2, 9, lastExisting - 1, 1).getValues().forEach(function (r) {
      var key = String(r[0] || "").replace(/\s+/g, "").toUpperCase();
      if (key) existingRfqs[key] = true;
    });
  }

  threads.forEach(function (thread) {
    var messages = thread.getMessages(); var matchedAny = false;
    messages.forEach(function (msg) {
      var subject = msg.getSubject() || "";
      var rfqMatch = subject.match(/RFQ\s*(\d+)/i);
      if (!rfqMatch) return; matchedAny = true;

      var quoteNumber = "RFQ" + rfqMatch[1];
      var key = quoteNumber.toUpperCase();
      if (existingRfqs[key]) return; // already in sheet (or earlier in this run)
      existingRfqs[key] = true;

      var fromRaw = msg.getFrom();
      var emailMatch = fromRaw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      var senderEmail = emailMatch ? emailMatch[0].toLowerCase() : fromRaw.toLowerCase();

      // Strip reply/forward prefixes (Re:, RE:, Fwd:, FW:, השב:, העבר:) from the subject
      var cleanSubject = subject.replace(/^\s*((re|fw|fwd|השב|העבר)\s*:\s*)+/i, "");
      var client = extractClient(cleanSubject);
      var topic = cleanSubject.replace(/RFQ\s*\d+/i, "").replace(/^[\s.\-:,]+/, "").trim();
      var notes = (msg.getPlainBody() || "").trim();
      var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

      rowsToAdd.push([
        Date.now() + Math.floor(Math.random() * 1000),
        client,
        topic,
        "waiting_supplier",
        "",
        notes,
        todayStr,
        senderEmail,
        quoteNumber
      ]);
    });
    if (matchedAny) { thread.addLabel(label); } else { thread.addLabel(unrecognizedLabel); }
  });

  if (rowsToAdd.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rowsToAdd.length, NUM_COLS).setValues(rowsToAdd);
  }

  } finally {
    lock.releaseLock();
  }
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

// Test/utility function (not part of production flow)
function addMissingEfqRow() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName("quotes") || ss.getSheets()[0];
  var row = [
    Date.now() + Math.floor(Math.random() * 1000),
    "alpha",
    "C/alpha lg lclc italy",
    "waiting_supplier",
    "",
    "2 cartons\n200 kg,\n1x1.2x1x3\n\nex ravenna to ashdod",
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
    "yoav@alpha-lg.com",
    "RFQ1111111"
  ];
  var lastRow = sheet.getLastRow();
  console.log('lastRow=' + lastRow);
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
}
