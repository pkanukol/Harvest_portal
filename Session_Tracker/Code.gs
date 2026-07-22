// ═══════════════════════════════════════════════════════════════════
//  Curriculum Tracker — Google Apps Script Backend
//  Users & SME mapping → Supabase REST API
//  Planner data       → subject-named Google Sheets tabs
//  POW_DATA, SME_REVIEWS → auto-created Google Sheets tabs
// ═══════════════════════════════════════════════════════════════════

const SS          = SpreadsheetApp.getActiveSpreadsheet();
const TAB_POW     = 'POW_DATA';
const TAB_REVIEWS = 'SME_REVIEWS';

// Designations treated as leadership — read-only across all teachers/subjects,
// can view POW cards and Progress Check but never create/edit a POW.
const LEADERSHIP_DESIGNATIONS = ['managing director', 'principal', 'vice principal', 'curriculum head', 'apm', 'chairman'];
function isLeadershipDesignation_(designation) {
  return LEADERSHIP_DESIGNATIONS.indexOf((designation || '').toLowerCase().trim()) !== -1;
}

// Map tab names → canonical subject names
const SUBJECT_MAP = {
  'english':        'English',
  'mathematics':    'Mathematics',
  'math':           'Mathematics',
  'maths':          'Mathematics',
  'social science': 'Social Science',
  'socialscience':  'Social Science',
  'science/evs':    'Science/EVS',
  'science':        'Science/EVS',
  'evs':            'Science/EVS',
};

// ─── Supabase ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://aouvxdfamzprykezeovl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE';

function supabase_(path) {
  const resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: 'GET',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    },
    muteHttpExceptions: true,
  });
  const text = resp.getContentText();
  return JSON.parse(text);
}

// ─── Entry point ────────────────────────────────────────────────────────────

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Curriculum Tracker — Harvest International School')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ─── Sheet bootstrap ─────────────────────────────────────────────────────────

function ensureSheets_() {
  if (!SS.getSheetByName(TAB_POW)) {
    const s = SS.insertSheet(TAB_POW);
    const hdrs = [
      'ID','Teacher Email','Subject','Grade','Week Start','Week End',
      'Topic','Subtopic','LP Session #',
      'CW','Binder','Activity','Homework',
      'CCT Topic Y/N','CCT Topic Text',
      'Impl A','Impl B','Impl C','Impl D','Impl E',
      'Correction Done','Instructions','Teacher Remarks',
      'Status','Created At','TBS MOM'
    ];
    s.appendRow(hdrs);
    s.getRange(1,1,1,hdrs.length).setFontWeight('bold').setBackground('#1a5c38').setFontColor('white');
    s.setFrozenRows(1);
  }
  if (!SS.getSheetByName(TAB_REVIEWS)) {
    const s = SS.insertSheet(TAB_REVIEWS);
    const hdrs = [
      'ID','POW ID','SME Email',
      'CCT Name','CCT Date','CCT Time','Conducted',
      'Approved Closed','SME Remarks',
      'Created At','Updated At',
      'CCT Discussed'
    ];
    s.appendRow(hdrs);
    s.getRange(1,1,1,hdrs.length).setFontWeight('bold').setBackground('#1a5c38').setFontColor('white');
    s.setFrozenRows(1);
  }
}

// ─── Authentication — Supabase users table ────────────────────────────────────

function getAutoLoginUser() {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { error: 'Unable to detect your Google account. Please refresh and try again.' };
    if (!email.toLowerCase().endsWith('@harvestinternationalschool.in')) {
      return { error: 'Please sign in with your Harvest International School Google account to continue.' };
    }
    const rows = supabase_(
      'users?email=eq.' + encodeURIComponent(email.toLowerCase().trim()) +
      '&select=id,name,email,designation,location,subject,role'
    );
    if (!Array.isArray(rows) || !rows.length) {
      return { error: 'Your account is not registered in the system yet. Please contact your administrator to get access.' };
    }
    const u = rows[0];
    const role = (u.role || '').toLowerCase();
    const isSme = role === 'sme' || (u.designation || '') === 'Subject Matter Expert';
    // 'auditor' is the shared role used for all leadership accounts (APM, Principal,
    // Vice Principal, Curriculum Head, Managing Director, Coordinator, etc.) — grant
    // them the same broad, read-only access as SME regardless of designation wording.
    const isLeadership = !isSme && (role === 'auditor' || isLeadershipDesignation_(u.designation));
    if (!u.subject && !isLeadership) {
      return { error: 'This app is for subject teachers and Subject Matter Experts for POW and TBS discussions. If you believe this is a mistake, please contact your administrator.' };
    }
    return {
      id:          u.id,
      name:        (u.name        || '').trim(),
      email:       (u.email       || '').toLowerCase().trim(),
      designation: u.designation  || '',
      role:        isSme ? 'SME' : (isLeadership ? 'Leadership' : 'Teacher'),
      subject:     (u.subject     || '').trim(),
      location:    (u.location    || '').trim(),
    };
  } catch (e) {
    return { error: 'Auto-login error: ' + e.message };
  }
}

function login(email, password) {
  try {
    const rows = supabase_(
      'users?email=eq.' + encodeURIComponent(email.toLowerCase().trim()) +
      '&select=id,name,email,designation,app_password,location,subject,role'
    );
    if (!Array.isArray(rows) || !rows.length) return { error: 'Invalid email or password.' };
    const u = rows[0];
    if ((u.app_password || '').trim() !== password.trim()) return { error: 'Invalid email or password.' };
    const isSme = u.designation === 'Subject Matter Expert';
    const isLeadership = !isSme && ((u.role || '').toLowerCase() === 'auditor' || isLeadershipDesignation_(u.designation));
    return {
      id:          u.id,
      name:        (u.name  || '').trim(),
      email:       (u.email || '').toLowerCase().trim(),
      designation: u.designation,
      role:        isSme ? 'SME' : (isLeadership ? 'Leadership' : 'Teacher'),
      subject:     (u.subject  || '').trim(),
      location:    (u.location || '').trim(),
    };
  } catch (e) {
    return { error: 'Login error: ' + e.message };
  }
}

// ─── Planner data ─────────────────────────────────────────────────────────────

// grade is optional — if omitted, returns all topics for the subject
function getTopics(subject, grade) {
  try {
    const sheet = SS.getSheetByName(subject);
    if (!sheet) return { success: false, topics: [], message: 'Sheet "' + subject + '" not found.' };

    const rows        = sheet.getDataRange().getValues();
    const filterGrade = grade ? parseInt(grade) : null;
    const topics      = [];

    for (let i = 0; i < rows.length; i++) {
      const row   = rows[i];
      const colA  = (row[0] || '').toString().trim();
      const colB  = row[1] instanceof Date
                    ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'MMMM')
                    : (row[1] || '').toString().trim();
      // Column C holds session count; Google Sheets may auto-format numbers as dates
      const colC  = row[2] instanceof Date
                    ? String(row[2].getDate())
                    : (row[2] || '').toString().trim();
      const colD  = (row[3] || '').toString().trim();
      const colE  = (row[4] || '').toString().trim();

      // Skip header row
      if (/^grade$/i.test(colA)) continue;
      if (!colD) continue;

      const rowGrade = parseInt(colA);
      if (filterGrade !== null && rowGrade !== filterGrade) continue;

      topics.push({
        topic:    colD,
        subtopic: colE,
        sessions: colC,
        month:    colB,
      });
    }
    return { success: true, topics: topics };
  } catch (e) {
    return { success: false, topics: [], message: e.message };
  }
}

function getSubtopics(subject, topic) {
  const res = getTopics(subject);
  const match = (res.topics || []).find(t => t.topic === topic);
  if (!match || !match.subtopic) return [];
  return match.subtopic.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

function getSessionCount(subject, topic) {
  const res = getTopics(subject);
  const match = (res.topics || []).find(t => t.topic === topic);
  if (!match || !match.sessions) return 5;
  return parseInt(match.sessions) || 5;
}

// ─── POW cards (dashboard) ────────────────────────────────────────────────────

// userEmail = logged-in user's email; role = 'Teacher' | 'SME'
function getPowCards(userEmail, role) {
  try {
    ensureSheets_();
    const powRows = SS.getSheetByName(TAB_POW).getDataRange().getValues();
    const revRows = SS.getSheetByName(TAB_REVIEWS).getDataRange().getValues();

    // Build review lookup: powId → review row
    const revMap = {};
    for (let i = 1; i < revRows.length; i++) {
      if (revRows[i][1]) revMap[revRows[i][1].toString()] = revRows[i];
    }

    // Build allowed-teacher map: email → {name, subject, location}
    const teacherMap = {};

    if (role === 'SME') {
      // 1. Get SME's DB id
      const smeRows = supabase_('users?email=eq.' + encodeURIComponent(userEmail) + '&select=id');
      if (!Array.isArray(smeRows) || !smeRows.length) return { success: true, cards: [], teachers: [] };
      const smeId = smeRows[0].id;

      // 2. Get teacher_ids mapped to this SME
      const mappings = supabase_('teacher_sme?sme_id=eq.' + smeId + '&select=teacher_id');
      if (!Array.isArray(mappings) || !mappings.length) return { success: true, cards: [], teachers: [] };
      const ids = mappings.map(m => m.teacher_id).join(',');

      // 3. Fetch teacher details
      const teachers = supabase_('users?id=in.(' + ids + ')&select=id,name,email,subject,location');
      (teachers || []).forEach(t => {
        teacherMap[(t.email || '').toLowerCase()] = {
          name:     t.name     || t.email,
          subject:  t.subject  || '',
          location: t.location || '',
        };
      });
    } else if (role === 'Leadership') {
      // Leadership sees POWs for every subject teacher across the school
      const allUsers = supabase_('users?select=id,name,email,subject,location,designation');
      (allUsers || []).forEach(t => {
        if (!t.subject || t.designation === 'Subject Matter Expert') return;
        teacherMap[(t.email || '').toLowerCase()] = {
          name:     t.name     || t.email,
          subject:  t.subject  || '',
          location: t.location || '',
        };
      });
    } else {
      // Teacher sees only their own POWs
      teacherMap[userEmail.toLowerCase()] = { name: '', subject: '', location: '' };
    }

    const cards = [];
    for (let i = 1; i < powRows.length; i++) {
      const r = powRows[i];
      if (!r[0]) continue;
      const temail = (r[1] || '').toString().toLowerCase();
      if (!teacherMap[temail]) continue;

      const powId     = (r[0] || '').toString().trim();
      if (!powId) continue;
      const rawStatus = (r[23] || '').toString().toLowerCase();
      const status    = rawStatus === 'approved' ? 'Approved'
                      : rawStatus === 'pending'  ? 'Pending Review'
                      : 'Created';

      cards.push({
        id:           powId,
        teacherEmail: temail,
        teacherName:  teacherMap[temail].name || temail,
        subject:      r[2],
        weekStart:    fmtDate_(r[4]),
        weekEnd:      fmtDate_(r[5]),
        topic:        r[6],
        status,
      });
    }
    cards.sort((a, b) => b.weekStart.localeCompare(a.weekStart));

    const teachers = Object.entries(teacherMap).map(([email, t]) => ({ email, ...t }));
    return { success: true, cards, teachers };
  } catch (e) {
    return { success: false, message: e.message, cards: [] };
  }
}

// ─── POW Create ───────────────────────────────────────────────────────────────

function createPow(data) {
  try {
    ensureSheets_();
    const sheet = SS.getSheetByName(TAB_POW);

    // Prevent exact duplicate: same teacher+subject+grade+weekStart+topic
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][1]||'').toString().toLowerCase() === data.teacherEmail.toLowerCase() &&
          (rows[i][2]||'').toString().toLowerCase() === (data.subject||'').toLowerCase() &&
          (rows[i][3]||'').toString()               === (data.grade||'').toString() &&
          fmtDate_(rows[i][4])                      === data.weekStart &&
          (rows[i][6]||'').toString().toLowerCase() === (data.topic||'').toLowerCase() &&
          (rows[i][7]||'').toString().toLowerCase() === (data.subtopic||'').toLowerCase()) {
        return { success: false, message: 'A POW already exists for this week, subject, grade, topic and sub-topic.' };
      }
    }

    const id = 'POW_' + new Date().getTime();
    sheet.appendRow([
      id,               data.teacherEmail, data.subject,      data.grade,
      data.weekStart,   data.weekEnd,
      data.topic,       data.subtopic,     (data.lpSessionNum || '').toString(),  // col 9 = LP Session #
      data.cw,          data.binder,       data.activity,     data.homework,
      data.cctTopicYN || data.cctTopicYn || '',  data.cctTopicText || '',
      data.implA,       data.implB,        data.implC,        data.implD,  data.implE,
      data.correctionDone, data.instructions, data.teacherRemarks,
      'created',        new Date().toISOString(), data.tbsMom || '',
    ]);
    // Force LP Session # cell (col 9) to text so Sheets never re-interprets "3, 4" as a date
    sheet.getRange(sheet.getLastRow(), 9).setNumberFormat('@TEXT');
    return { success: true, id: id };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ─── POW Get (detail view) ────────────────────────────────────────────────────

// Recover the original session-number string from a Date object that Google Sheets
// created by auto-parsing the stored string as a date.
// How Sheets corrupts the data:
//   "3, 4"   → parsed as "March 4"   → Date(1900-03-04) → month=3, day=4  → "3, 4"
//   "2, 3"   → parsed as "Feb 3"     → Date(1900-02-03) → month=2, day=3  → "2, 3"
//   "1, 2"   → parsed as "Jan 2"     → Date(1900-01-02) → month=1, day=2  → ambiguous,
//              could also be serial 2 = single session "2"; we return "2" (max is still correct)
//   "6"      → serial 6              → Date(1900-01-06) → month=1, day=6  → "6"
// Three-or-more values ("1, 2, 3") are NOT valid date strings → stored as text → pass through.
function cleanLpSession_(raw) {
  if (!raw) return '';
  if (raw instanceof Date) {
    var m = raw.getMonth() + 1; // 1-based month
    var d = raw.getDate();
    // month > 1 means the string was a "M, D" pair parsed as a date
    return m > 1 ? (m + ', ' + d) : String(d);
  }
  var s = raw.toString().trim();
  // Already a clean number / comma-separated list
  if (/^[\d,\s]+$/.test(s)) return s;
  // Full date string accidentally stored by old code — extract via Date parse
  if (s.length > 10 && /\d{4}/.test(s)) {
    try {
      var dt = new Date(s);
      if (!isNaN(dt.getTime())) {
        var m2 = dt.getMonth() + 1;
        var d2 = dt.getDate();
        return m2 > 1 ? (m2 + ', ' + d2) : String(d2);
      }
    } catch(e) {}
  }
  return s;
}

function getPow(powId) {
  var result = { success: false, message: 'getPow did not complete' };
  try {
    var searchId = (powId || '').toString().trim();
    var powSheet = SS.getSheetByName(TAB_POW);
    if (!powSheet) return { success: false, message: 'Sheet ' + TAB_POW + ' not found' };
    var powRows = powSheet.getDataRange().getValues();

    var revSheet = SS.getSheetByName(TAB_REVIEWS);
    var revRows = revSheet ? revSheet.getDataRange().getValues() : [];

    var pow = null;
    for (var i = 1; i < powRows.length; i++) {
      if ((powRows[i][0] || '').toString().trim() !== searchId) continue;
      var r = powRows[i];
      pow = {
        id:             (r[0]  || '').toString(),
        teacherEmail:   (r[1]  || '').toString(),
        teacherName:    (r[1]  || '').toString(),
        subject:        (r[2]  || '').toString(),
        grade:          (r[3]  || '').toString(),
        weekStart:      fmtDate_(r[4]),
        weekEnd:        fmtDate_(r[5]),
        topic:          (r[6]  || '').toString(),
        subtopic:       (r[7]  || '').toString(),
        lpSessionNum:   cleanLpSession_(r[8]),
        cw:             (r[9]  || '').toString(),
        binder:         (r[10] || '').toString(),
        activity:       (r[11] || '').toString(),
        homework:       (r[12] || '').toString(),
        cctTopicYn:     (r[13] || '').toString(),
        cctTopicText:   (r[14] || '').toString(),
        implA:          (r[15] || '').toString(),
        implB:          (r[16] || '').toString(),
        implC:          (r[17] || '').toString(),
        implD:          (r[18] || '').toString(),
        implE:          (r[19] || '').toString(),
        correctionDone: (r[20] || '').toString(),
        instructions:   (r[21] || '').toString(),
        teacherRemarks: (r[22] || '').toString(),
        status:         (r[23] || '').toString(),
        tbsMom:         (r[25] || '').toString(),
      };
      break;
    }

    if (!pow) {
      return { success: false, message: 'POW not found (ID: ' + searchId + ', rows checked: ' + (powRows.length - 1) + ')' };
    }

    var review = null;
    for (var j = 1; j < revRows.length; j++) {
      if ((revRows[j][1] || '').toString().trim() !== searchId) continue;
      var rv = revRows[j];
      review = {
        id:             (rv[0] || '').toString(),
        powId:          (rv[1] || '').toString(),
        smeEmail:       (rv[2] || '').toString(),
        approvedClosed: rv[7] ? true : false,
        remarks:        (rv[8] || '').toString(),
        cctDiscussed:   rv[11] ? true : false,
      };
      break;
    }

    result = { success: true, pow: pow, review: review };
  } catch (e) {
    result = { success: false, message: 'getPow error: ' + e.message };
  }
  return result;
}

// ─── SME Review Save ──────────────────────────────────────────────────────────

// SME_REVIEWS columns (0-indexed):
// 0=ID, 1=POW ID, 2=SME Email, 3=CCT Name(legacy), 4=CCT Date(legacy), 5=CCT Time(legacy),
// 6=Conducted(legacy), 7=Approved Closed, 8=SME Remarks, 9=Created At, 10=Updated At,
// 11=CCT Discussed
function saveSmeReview(powId, reviewData, smeEmail) {
  try {
    ensureSheets_();
    const sheet = SS.getSheetByName(TAB_REVIEWS);
    const rows  = sheet.getDataRange().getValues();
    const now   = new Date().toISOString();
    let rowIdx  = -1;

    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][1]||'').toString() === powId) { rowIdx = i + 1; break; }
    }

    const approved = reviewData.approvedClosed ? 1 : 0;

    const powSheet2 = SS.getSheetByName(TAB_POW);
    const powRows2  = powSheet2.getDataRange().getValues();
    let currentPowStatus = '';
    for (let j = 1; j < powRows2.length; j++) {
      if ((powRows2[j][0]||'').toString() === powId) {
        currentPowStatus = (powRows2[j][23]||'').toString().toLowerCase();
        break;
      }
    }

    const rowData = (old) => [
      old ? old[0] : 'REV_' + new Date().getTime(),
      powId, smeEmail,
      '', '', '', '',  // legacy fields — unused
      approved,
      reviewData.remarks !== undefined ? reviewData.remarks : (old ? old[8] : ''),
      old ? old[9] : now, now,
      reviewData.cctDiscussed !== undefined ? (reviewData.cctDiscussed ? 1 : 0) : (old ? (old[11] || 0) : 0),
    ];

    if (rowIdx > 0) {
      const old = rows[rowIdx - 1];
      sheet.getRange(rowIdx, 1, 1, 12).setValues([rowData(old)]);
    } else {
      sheet.appendRow(rowData(null));
    }

    const newStatus = approved ? 'approved' : currentPowStatus;
    if (newStatus) setPowStatus_(powId, newStatus);

    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ─── Monthly progress summary ────────────────────────────────────────────────

function getProgressSummary(subject, grade, teacherEmail) {
  try {
    var tz      = Session.getScriptTimeZone();
    var today   = new Date();
    var month   = Utilities.formatDate(today, tz, 'MMMM');
    var yr      = today.getFullYear();
    var mIdx    = today.getMonth();
    var lastDay = new Date(yr, mIdx + 1, 0);
    var daysLeft = Math.max(0, Math.round((lastDay - today) / 86400000));

    // Planned topics for this subject + grade + month
    var planRes       = getTopics(subject, grade);
    var plannedTopics = (planRes.topics || []).filter(function(t) {
      return (t.month || '').toLowerCase() === month.toLowerCase();
    });
    var totalSessionsPlanned = plannedTopics.reduce(function(s, t) { return s + (parseInt(t.sessions) || 0); }, 0);

    // POWs submitted by this teacher for this subject + grade + month
    var powSheet = SS.getSheetByName(TAB_POW);
    var sessionsDone = 0;
    var coveredTopics = [];

    if (powSheet) {
      var rows = powSheet.getDataRange().getValues();
      var topicSessionMap = {}; // topic -> max session number done

      for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        if (!r[0]) continue;
        // Filter by teacher email only when a specific teacher is requested
        if (teacherEmail && (r[1]||'').toString().toLowerCase() !== teacherEmail.toLowerCase()) continue;
        if ((r[2]||'').toString().toLowerCase() !== subject.toLowerCase()) continue;
        if ((r[3]||'').toString() !== grade.toString()) continue;
        // Only count POWs the SME has approved
        var rowStatus = (r[23]||'').toString().toLowerCase();
        if (rowStatus !== 'approved' && rowStatus !== 'final') continue;
        if (r[4]) {
          var powMonth = Utilities.formatDate(new Date(r[4]), tz, 'MMMM');
          if (powMonth !== month) continue;
        }
        var topic = (r[6]||'').toString().trim();
        if (!topic) continue;
        // LP session can be "1" or "1, 2, 3" — take max
        var lpStr  = cleanLpSession_(r[8]);
        var nums   = lpStr.split(/[,\s]+/).map(Number).filter(function(n) { return !isNaN(n) && n > 0; });
        var maxSess = nums.length ? Math.max.apply(null, nums) : 1;
        if (!topicSessionMap[topic] || maxSess > topicSessionMap[topic]) {
          topicSessionMap[topic] = maxSess;
        }
      }

      coveredTopics = Object.keys(topicSessionMap);
      sessionsDone  = coveredTopics.reduce(function(s, t) { return s + topicSessionMap[t]; }, 0);
    }

    // Per-topic breakdown
    var topicRows = plannedTopics.map(function(t) {
      var done   = topicSessionMap ? (topicSessionMap[t.topic] || 0) : 0;
      var plan   = parseInt(t.sessions) || 0;
      var pct    = plan > 0 ? Math.round(done / plan * 100) : 0;
      return {
        topic:            t.topic,
        subtopic:         t.subtopic,
        sessionsPlanned:  plan,
        sessionsDone:     done,
        sessionsLeft:     Math.max(0, plan - done),
        pct:              Math.min(100, pct),
        status:           done === 0 ? 'pending' : (done >= plan ? 'done' : 'in_progress'),
      };
    });

    // Topics in POWs this month that are NOT in the planner (extra topics)
    var plannedNames = plannedTopics.map(function(t) { return t.topic; });
    var extraTopics  = coveredTopics.filter(function(t) { return plannedNames.indexOf(t) === -1; });

    var sessionsLeft = Math.max(0, totalSessionsPlanned - sessionsDone);
    var weeksLeft    = daysLeft / 5;
    var sessPerWeek  = weeksLeft > 0 ? Math.ceil(sessionsLeft / weeksLeft) : sessionsLeft;

    return {
      success:              true,
      month:                month,
      grade:                grade,
      daysLeft:             daysLeft,
      topicsPlanned:        plannedTopics.length,
      topicsCovered:        coveredTopics.filter(function(t) { return plannedNames.indexOf(t) !== -1; }).length,
      totalSessionsPlanned: totalSessionsPlanned,
      sessionsDone:         sessionsDone,
      sessionsLeft:         sessionsLeft,
      sessPerWeekNeeded:    sessPerWeek,
      topicRows:            topicRows,
      extraTopics:          extraTopics,
    };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─── Progress data ────────────────────────────────────────────────────────────

function getProgressData(subject) {
  try {
    const res = getTopics(subject);
    const topics = res.topics || [];
    const empty = { success: true, labels: [], planned: [], actual: [], verdict: 'No planner data', totalPlanned: 0, currentActual: 0, analysis: [] };
    if (!topics.length) return empty;

    // Academic-year month order from planner row sequence
    const monthOrder = [];
    topics.forEach(t => { if (t.month && !monthOrder.includes(t.month)) monthOrder.push(t.month); });

    // Cumulative sessions before each topic (by planner position)
    const cumBefore = [];
    let cumTotal = 0;
    topics.forEach(t => { cumBefore.push(cumTotal); cumTotal += parseInt(t.sessions) || 0; });
    const totalPlanned = cumTotal;

    // Cumulative planned sessions by end of each planner month
    const monthCum = {};
    let mRun = 0;
    monthOrder.forEach(m => {
      topics.filter(t => t.month === m).forEach(t => { mRun += parseInt(t.sessions) || 0; });
      monthCum[m] = mRun;
    });

    const powSheet = SS.getSheetByName(TAB_POW);
    if (!powSheet) return Object.assign({}, empty, { verdict: 'No data yet' });

    const pows = powSheet.getDataRange().getValues();
    const weekMap = {};

    for (let i = 1; i < pows.length; i++) {
      const r = pows[i];
      if (!r[0]) continue;
      if ((r[2]||'').toString().toLowerCase() !== subject.toLowerCase()) continue;
      if ((r[3]||'').toString() !== grade.toString()) continue;
      const wk = fmtDate_(r[4]);
      if (!wk) continue;

      const powMonth  = Utilities.formatDate(new Date(r[4]), Session.getScriptTimeZone(), 'MMMM');
      const topic     = (r[6]||'').toString().trim();
      const lpSession = parseInt(r[8]) || 0;
      const topicIdx  = topics.findIndex(t => t.topic === topic);
      const cumActual = topicIdx >= 0 ? cumBefore[topicIdx] + lpSession : 0;

      if (!weekMap[wk] || cumActual > (weekMap[wk].cumActual || 0)) {
        weekMap[wk] = { powMonth, topic, lpSession, topicIdx, cumActual };
      }
    }

    const weeks = Object.keys(weekMap).sort();
    if (!weeks.length) return Object.assign({}, empty, { verdict: 'No POWs submitted yet' });

    const labels = [], planned = [], actual = [], analysis = [];

    weeks.forEach((wk, i) => {
      const d = weekMap[wk];
      labels.push('W' + (i + 1) + ' (' + fmtDisplayDate_(wk) + ')');
      actual.push(d.cumActual);
      planned.push(monthCum[d.powMonth] || 0);

      const t = d.topicIdx >= 0 ? topics[d.topicIdx] : null;
      const plannerMonth    = t ? t.month : null;
      const plannerSessions = t ? (parseInt(t.sessions) || 0) : 0;
      const powMIdx  = monthOrder.indexOf(d.powMonth);
      const planMIdx = plannerMonth ? monthOrder.indexOf(plannerMonth) : -1;

      let status, statusDetail;
      if (!t) {
        status = 'unknown'; statusDetail = 'Topic not found in planner';
      } else if (d.powMonth === plannerMonth) {
        if (d.lpSession <= plannerSessions) {
          status = 'on_track';
          statusDetail = 'Session ' + d.lpSession + '/' + plannerSessions + ' in ' + d.powMonth;
        } else {
          status = 'behind';
          statusDetail = 'Session ' + d.lpSession + ' exceeds ' + plannerSessions + ' planned for ' + plannerMonth;
        }
      } else if (powMIdx >= 0 && planMIdx >= 0) {
        status = powMIdx < planMIdx ? 'ahead' : 'behind';
        statusDetail = status === 'ahead'
          ? 'Covering ' + plannerMonth + ' topic in ' + d.powMonth + ' (ahead)'
          : 'Should be in ' + plannerMonth + ', currently in ' + d.powMonth + ' (behind)';
      } else {
        status = 'unknown'; statusDetail = 'Month "' + d.powMonth + '" not in planner sequence';
      }

      analysis.push({
        week: fmtDisplayDate_(wk), topic: d.topic,
        powMonth: d.powMonth, plannerMonth: plannerMonth || '—',
        lpSession: d.lpSession, plannerSessions, status, statusDetail,
      });
    });

    const latest = analysis[analysis.length - 1];
    const verdict = latest.status === 'ahead'    ? '🟢 Ahead of plan'
                  : latest.status === 'behind'   ? '🔴 Behind plan'
                  : latest.status === 'on_track' ? '🟡 On track'
                  : '⚪ Unknown';

    return { success: true, labels, planned, actual, totalPlanned, currentActual: actual[actual.length - 1] || 0, verdict, analysis };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveSubjectSheet_(subject) {
  return SUBJECT_MAP[subject.toLowerCase()] || subject;
}


// Update implementation + teacher notes columns of an existing POW
// POW_DATA cols (1-indexed): Impl A-E = 16-20, Correction Done = 21, Instructions = 22, Teacher Remarks = 23
// Status always stays 'created' after teacher saves (finalSave is a UI confirmation only)
function updatePowImpl(powId, implData, finalSave) {
  try {
    const sheet = SS.getSheetByName(TAB_POW);
    const rows  = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0]||'').toString() !== powId) continue;
      sheet.getRange(i + 1, 16, 1, 8).setValues([[
        implData.implA          || '',
        implData.implB          || '',
        implData.implC          || '',
        implData.implD          || '',
        implData.implE          || '',
        implData.correctionDone || '',
        implData.instructions   || '',
        implData.teacherRemarks || '',
      ]]);
      // TBS MOM is at col 26 (1-indexed)
      sheet.getRange(i + 1, 26).setValue(implData.tbsMom || '');
      if (finalSave) setPowStatus_(powId, 'final');
      return { success: true, finalSave: !!finalSave };
    }
    return { success: false, message: 'POW not found.' };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function setPowStatus_(powId, status) {
  const sheet = SS.getSheetByName(TAB_POW);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0]||'').toString() === powId) {
      sheet.getRange(i + 1, 24).setValue(status); // col 24 = Status
      break;
    }
  }
}

function fmtDate_(d) {
  if (!d) return '';
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return d.toString();
    return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch(e) { return d.toString(); }
}

function fmtDisplayDate_(iso) {
  if (!iso) return '';
  try {
    return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), 'dd MMM');
  } catch(e) { return iso; }
}