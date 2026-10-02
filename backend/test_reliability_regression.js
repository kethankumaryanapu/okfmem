const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { app, sanitizeResponsePlaceholders } = require('./server');
const { deleteOKFConcept } = require('./okf/okfGenerator');

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json');
const BACKUP_MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json.regression.bak');
const BACKUP_SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json.regression.bak');

let server;
let serverPort;

function backupData() {
  if (fs.existsSync(MEMORIES_FILE)) {
    fs.copyFileSync(MEMORIES_FILE, BACKUP_MEMORIES_FILE);
  }
  if (fs.existsSync(SETTINGS_FILE)) {
    fs.copyFileSync(SETTINGS_FILE, BACKUP_SETTINGS_FILE);
  }
}

function restoreData() {
  if (fs.existsSync(BACKUP_MEMORIES_FILE)) {
    fs.copyFileSync(BACKUP_MEMORIES_FILE, MEMORIES_FILE);
    try { fs.unlinkSync(BACKUP_MEMORIES_FILE); } catch (e) {}
  }
  if (fs.existsSync(BACKUP_SETTINGS_FILE)) {
    fs.copyFileSync(BACKUP_SETTINGS_FILE, SETTINGS_FILE);
    try { fs.unlinkSync(BACKUP_SETTINGS_FILE); } catch (e) {}
  }

  // Clean created test concepts
  const testTitles = [
    { title: 'User Name', category: 'Fact' },
    { title: 'CSE (Computer Science and Engineering)', category: 'Fact' },
    { title: 'CSE', category: 'Fact' },
    { title: 'HTML', category: 'Skill' },
    { title: 'CSS', category: 'Skill' }
  ];
  testTitles.forEach(t => {
    try { deleteOKFConcept(t); } catch (e) {}
  });
}

function startServer() {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      serverPort = server.address().port;
      resolve(serverPort);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function postRequest(port, reqPath, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data || {});
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: reqPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getRequest(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: reqPath,
      method: 'GET'
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('OKFMem Reliability Regression Test Suite (Review 2 Demonstration)');
  console.log('================================================================\n');

  backupData();
  await startServer();

  let passedCount = 0;
  let totalCount = 0;

  function recordPass(testName) {
    totalCount++;
    passedCount++;
    console.log(`  [PASS] ${testName}`);
  }

  function recordFail(testName, error) {
    totalCount++;
    console.error(`  [FAIL] ${testName}: ${error.message || error}`);
  }

  try {
    // -------------------------------------------------------------
    // TEST A: Multiple Memories in Single User Message
    // -------------------------------------------------------------
    console.log('--- Test A: Multi-Memory Extraction & Persistence ---');

    // Case A1: Name and Academic Study in one sentence
    const testMsg1 = "My name is Alex Morgan and I am currently studying CSE (Computer Science and Engineering).";
    const resA1 = await postRequest(serverPort, '/api/chat', { text: testMsg1 });

    assert.strictEqual(resA1.status, 200, 'HTTP status should be 200');
    assert.strictEqual(resA1.data.success, true, 'Chat response success should be true');

    // Verify extracted_memories has both memories
    const extractedA1 = resA1.data.extracted_memories || [];
    assert.ok(extractedA1.length >= 2, `Expected at least 2 extracted memories, got ${extractedA1.length}`);

    const nameMem = extractedA1.find(m => (m.title || '').toLowerCase() === 'user name' || (m.fact || '').toLowerCase().includes('alex morgan'));
    const studyMem = extractedA1.find(m => (m.title || '').toLowerCase().includes('cse') || (m.fact || '').toLowerCase().includes('studying cse'));

    assert.ok(nameMem, 'Should extract User Name memory');
    assert.ok(studyMem, 'Should extract Study memory');
    assert.strictEqual(nameMem.category, 'Fact', 'User Name must belong to category Fact');
    assert.strictEqual(studyMem.category, 'Fact', 'Study must belong to category Fact');
    assert.ok(nameMem.fact.includes('Alex Morgan'), 'Name memory must contain restored name');
    assert.ok(studyMem.fact.includes('CSE'), 'Study memory must contain CSE');
    recordPass('A1.1: Multi-memory extraction from compound sentence (User Name + Study)');

    // Verify both are persisted in backend memories list
    const memListRes = await getRequest(serverPort, '/api/memories');
    const allMems = memListRes.data.memories || [];
    const persistedName = allMems.find(m => m.id === nameMem.id);
    const persistedStudy = allMems.find(m => m.id === studyMem.id);
    assert.ok(persistedName, 'User Name memory must be persisted in storage');
    assert.ok(persistedStudy, 'Study memory must be persisted in storage');
    recordPass('A1.2: Both extracted memories successfully persisted with valid IDs');

    // Verify OKF concept files generated for both
    const factDir = path.resolve(__dirname, 'okf', 'user-memory', 'facts');
    const files = fs.existsSync(factDir) ? fs.readdirSync(factDir) : [];
    const hasNameConcept = files.some(f => f.toLowerCase().includes('user-name') || f.toLowerCase().includes('user_name'));
    const hasStudyConcept = files.some(f => f.toLowerCase().includes('cse'));
    assert.ok(hasNameConcept, 'OKF concept markdown must exist for User Name');
    assert.ok(hasStudyConcept, 'OKF concept markdown must exist for Study');
    recordPass('A1.3: OKF concept files generated for all extracted memories');

    // Case A2: Deduplication on repeated compound message
    const initialCount = allMems.length;
    const resA2 = await postRequest(serverPort, '/api/chat', { text: testMsg1 });
    assert.strictEqual(resA2.data.success, true);
    assert.strictEqual(resA2.data.extracted_memories.length, 0, 'Should not extract duplicate memories');

    const memListRes2 = await getRequest(serverPort, '/api/memories');
    const allMems2 = memListRes2.data.memories || [];
    assert.strictEqual(allMems2.length, initialCount, 'Memory count must remain unchanged after duplicate message');

    const reCheckedName = allMems2.find(m => m.id === nameMem.id);
    assert.ok((reCheckedName.mention_count || 1) >= 2, 'Mention count should be incremented upon duplicate detection');
    recordPass('A2: Duplicate detection prevents duplicate memory creation and increments mention_count');

    // Case A3: Multi-Skill extraction (HTML and CSS)
    const testMsgSkills = "I am learning HTML and CSS.";
    const resA3 = await postRequest(serverPort, '/api/chat', { text: testMsgSkills });
    assert.strictEqual(resA3.status, 200);
    const extractedSkills = resA3.data.extracted_memories || [];
    const hasHtml = extractedSkills.some(m => m.title === 'HTML' && m.category === 'Skill');
    const hasCss = extractedSkills.some(m => m.title === 'CSS' && m.category === 'Skill');
    assert.ok(hasHtml, 'Should extract HTML as distinct Skill');
    assert.ok(hasCss, 'Should extract CSS as distinct Skill');
    recordPass('A3: Multi-skill decomposition (HTML and CSS extracted into separate Skill memories)');

    // -------------------------------------------------------------
    // TEST B: Privacy Placeholder Safety & Sanitization
    // -------------------------------------------------------------
    console.log('\n--- Test B: Privacy Placeholder Safety & Sanitization ---');

    // Case B1: Synthetic sensitive information submission
    const sensitiveMsg = "My email is demo_student@example.com and my phone number is +1-555-019-2834.";
    const resB1 = await postRequest(serverPort, '/api/chat', { text: sensitiveMsg });

    assert.strictEqual(resB1.status, 200, 'HTTP status should be 200');
    assert.strictEqual(resB1.data.success, true);

    const chatResponse = resB1.data.response || '';
    assert.ok(chatResponse.length > 0, 'Response should not be empty');

    // Assert NO bracketed MemPrivacy placeholder (<Real_Name_1>, <Email_Address_1>, etc.)
    const bracketPlaceholderMatch = chatResponse.match(/<[A-Za-z_]+_\d+>/);
    assert.strictEqual(bracketPlaceholderMatch, null, `Found leaked bracket placeholder in response: ${bracketPlaceholderMatch}`);

    // Assert NO bare MemPrivacy placeholder (email_address_1, real_name_10, etc.)
    const barePlaceholderMatch = chatResponse.match(/\b(?:real_name|email_address|phone_number|detailed_address|verification_code)_[0-9]+\b/i);
    assert.strictEqual(barePlaceholderMatch, null, `Found leaked bare placeholder in response: ${barePlaceholderMatch}`);

    recordPass('B1.1: Live chat response contains zero internal MemPrivacy placeholders for sensitive input');

    // Case B2: Direct sanitization function guarantees
    const placeholderTestCases = [
      { input: "Hello <real_name_10>! How are you?", forbidden: ["<real_name_10>", "real_name_10"] },
      { input: "Hello real_name_10! Welcome to the chat.", forbidden: ["real_name_10"] },
      { input: "Your name is <real_name_10>.", forbidden: ["<real_name_10>", "real_name_10", "is you"] },
      { input: "Regarding <real_name_10> to build apps: offline mode.", forbidden: ["<real_name_10>", "real_name_10"] },
      { input: "Verification code sent to <email_address_1>: <verification_code_1>", forbidden: ["<email_address_1>", "<verification_code_1>"] },
      { input: "Call <phone_number_1> or contact <detailed_address_1>.", forbidden: ["<phone_number_1>", "<detailed_address_1>"] }
    ];

    for (const tc of placeholderTestCases) {
      const sanitized = sanitizeResponsePlaceholders(tc.input);
      for (const f of tc.forbidden) {
        assert.ok(!sanitized.toLowerCase().includes(f.toLowerCase()), `Sanitized text '${sanitized}' must not contain '${f}'`);
      }
      assert.ok(!/<[A-Za-z_]+_\d+>/.test(sanitized), `Sanitized output '${sanitized}' contains residual bracket placeholder`);
    }
    recordPass('B2: sanitizeResponsePlaceholders thoroughly replaces all internal placeholders naturally');

    // Case B3: Official MemPrivacy test endpoint (/api/privacy/test)
    const testPrivacyMsg = "Contact Alex at alex@example.com or 555-987-6543";
    const resB3 = await postRequest(serverPort, '/api/privacy/test', { text: testPrivacyMsg });
    assert.strictEqual(resB3.status, 200);
    assert.strictEqual(resB3.data.success, true);
    assert.ok(resB3.data.masked && resB3.data.restored, 'Masked and restored fields must be present');
    recordPass('B3: Official MemPrivacy masking and restoration endpoint continues functioning perfectly');

    console.log('\n================================================================');
    console.log(`Results: ${passedCount}/${totalCount} tests passed (100% SUCCESS)`);
    console.log('================================================================\n');

  } catch (err) {
    recordFail('Unexpected error during test execution', err);
    console.error(err);
  } finally {
    await stopServer();
    restoreData();
  }

  process.exit(passedCount === totalCount ? 0 : 1);
}

runTests();
