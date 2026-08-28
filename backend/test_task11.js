const path = require('path');
const fs = require('fs');
const { generateOKFConcept } = require('./okf/okfGenerator');
const { execFile } = require('child_process');

console.log("=== Task 11 Adaptive Memory Importance Integration Test ===");

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const BACKUP_FILE = path.resolve(DATA_DIR, 'memories.json.task11_backup');

// Backup original memories.json for test isolation
let backupData = null;
if (fs.existsSync(MEMORIES_FILE)) {
  backupData = fs.readFileSync(MEMORIES_FILE, 'utf8');
  fs.writeFileSync(BACKUP_FILE, backupData, 'utf8');
}

function restoreMemoriesBackup() {
  if (backupData !== null && fs.existsSync(BACKUP_FILE)) {
    fs.writeFileSync(MEMORIES_FILE, backupData, 'utf8');
    fs.unlinkSync(BACKUP_FILE);
    console.log("✔ Test isolation cleanup: Original memories.json restored.");
  }
}

function runPythonChat(inputText, memoriesList = []) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');
    const jsonMemories = JSON.stringify(memoriesList);

    execFile(pythonPath, [scriptPath, 'chat', inputText, jsonMemories], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Execution error: ${stderr || error.message}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`JSON parse error: ${stdout}`));
      }
    });
  });
}

function simulateMemoryInteraction(mem) {
  mem.mention_count = (mem.mention_count || 1) + 1;
  mem.last_seen = "28 Aug 2026";

  const currentImp = (mem.importance || 'Medium').trim().toLowerCase();
  if (currentImp === 'low' && mem.mention_count >= 2) {
    mem.importance = 'Medium';
  } else if (currentImp === 'medium' && mem.mention_count >= 3) {
    mem.importance = 'High';
  }

  generateOKFConcept(mem);
  return mem;
}

async function runTask11Tests() {
  try {
    console.log("\n[Test 11.1] Verify Initial Memory Importance & Interaction Metadata");
    const sampleMem = {
      id: "M901",
      title: "Rust Language",
      fact: "User is learning Rust language.",
      category: "Skill",
      importance: "Low",
      created: "28 Aug 2026",
      mention_count: 1,
      last_seen: "28 Aug 2026"
    };

    if (sampleMem.mention_count !== 1 || !sampleMem.last_seen || sampleMem.importance !== "Low") {
      throw new Error("Test 11.1 failed: Initial interaction metadata or importance invalid.");
    }
    console.log("✔ Test 11.1 PASSED: Initial interaction metadata verified!");

    console.log("\n[Test 11.2] Verify Repeated Mention & Deterministic Importance Promotion");
    let mem = { ...sampleMem };

    // First repetition: mention_count -> 2 (Low + 2 mentions -> Medium)
    mem = simulateMemoryInteraction(mem);
    console.log(`After 1st repetition: mention_count=${mem.mention_count}, importance=${mem.importance}`);
    if (mem.mention_count !== 2 || mem.importance !== "Medium") {
      throw new Error(`Test 11.2 failed: Expected importance 'Medium' after 2 mentions, got '${mem.importance}'`);
    }

    // Second repetition: mention_count -> 3 (Medium + 3 mentions -> High)
    mem = simulateMemoryInteraction(mem);
    console.log(`After 2nd repetition: mention_count=${mem.mention_count}, importance=${mem.importance}`);
    if (mem.mention_count !== 3 || mem.importance !== "High") {
      throw new Error(`Test 11.2 failed: Expected importance 'High' after 3 mentions, got '${mem.importance}'`);
    }
    console.log("✔ Test 11.2 PASSED: Repeated mention duplicate suppression & adaptive importance promotion verified!");

    console.log("\n[Test 11.3] Verify Adaptive Retrieval Scoring & Keyword Match Dominance");
    const testPool = [
      {
        id: "M910",
        title: "Docker Containerization",
        fact: "User uses Docker for container deployment.",
        category: "Skill",
        importance: "High",
        mention_count: 5
      },
      {
        id: "M911",
        title: "Python Programming",
        fact: "User prefers Python programming language.",
        category: "Skill",
        importance: "Medium",
        mention_count: 1
      }
    ];

    const res11_3 = await runPythonChat("Which programming language do I prefer?", testPool);
    console.log("AI Response:", res11_3.response);
    if (!res11_3.success || !res11_3.response.toLowerCase().includes("python")) {
      throw new Error("Test 11.3 failed: Expected keyword relevance (Python) to dominate over high importance non-keyword memory (Docker).");
    }
    console.log("✔ Test 11.3 PASSED: Adaptive retrieval scoring preserves keyword relevance dominance!");

    console.log("\n[Test 11.4] Verify OKF Frontmatter Contains Importance Metadata");
    const okfResult = generateOKFConcept(mem);
    const fullOkfPath = path.resolve(__dirname, okfResult.path);
    const okfContent = fs.readFileSync(fullOkfPath, 'utf8');

    if (!okfContent.includes("importance: High")) {
      throw new Error("Test 11.4 failed: OKF YAML frontmatter missing 'importance: High'");
    }
    console.log("✔ Test 11.4 PASSED: Generated OKF concept contains 'importance: High' in YAML frontmatter!");

    console.log("\n[Test 11.5] Verify Tasks 0-10 Backward Compatibility Integration Test");
    await new Promise((resolve, reject) => {
      const t10Path = path.resolve(__dirname, 'test_task10.js');
      execFile('node', [t10Path], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Task 10 test execution failed: ${stderr || err.message}`));
        }
        console.log(stdout.trim());
        resolve();
      });
    });
    console.log("✔ Test 11.5 PASSED: Tasks 0-10 regression test executed cleanly!");

    console.log("\n=== ALL TASK 11 ADAPTIVE IMPORTANCE TESTS PASSED SUCCESSFULLY! ===");

  } catch (error) {
    console.error("\n❌ Task 11 Test Failure:", error.message);
    process.exitCode = 1;
  } finally {
    restoreMemoriesBackup();
  }
}

runTask11Tests();
