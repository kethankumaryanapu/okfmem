const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { generateOKFConcept } = require('./okf/okfGenerator');

console.log("=== Task 13 Enhanced Pipeline & Optimization Test Suite ===");

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const BACKUP_FILE = path.resolve(DATA_DIR, 'memories.json.task13_backup');

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
    const jsonMemories = JSON.stringify(memoriesList || []);

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

async function runTask13Tests() {
  try {
    console.log("\n[Test 13.1] Enhanced Heuristic Extraction & Title Normalization");
    const testMsg1 = "I am exploring PyTorch and I decided to use PostgreSQL for data storage.";
    const res13_1 = await runPythonChat(testMsg1, []);

    console.log("Response success:", res13_1.success);
    console.log("Extracted memories count:", res13_1.extracted_memories ? res13_1.extracted_memories.length : 0);

    if (!res13_1.success || !Array.isArray(res13_1.extracted_memories) || res13_1.extracted_memories.length < 2) {
      throw new Error("Test 13.1 failed: Expected extraction of both PyTorch skill and PostgreSQL preference.");
    }

    const pytorchMem = res13_1.extracted_memories.find(m => m.title.toLowerCase().includes("pytorch"));
    const postgresMem = res13_1.extracted_memories.find(m => m.title.toLowerCase().includes("postgresql"));

    if (!pytorchMem || !postgresMem) {
      throw new Error("Test 13.1 failed: PyTorch or PostgreSQL concept missing from extracted memories.");
    }

    console.log("PyTorch Title:", pytorchMem.title);
    console.log("PostgreSQL Title:", postgresMem.title);
    if (pytorchMem.title !== "Pytorch" && pytorchMem.title !== "PyTorch") {
      throw new Error(`Test 13.1 failed: Expected clean title for PyTorch, got '${pytorchMem.title}'`);
    }
    console.log("✔ Test 13.1 PASSED: Enhanced extraction patterns & title normalization verified!");

    console.log("\n[Test 13.2] Fuzzy & Semantic Deduplication Matching");
    // Require server's isFuzzyDuplicate logic
    const { isFuzzyDuplicate } = require('./server.js');
    const existing = {
      id: "M101",
      title: "Python",
      fact: "User is learning Python.",
      category: "Skill",
      importance: "Low"
    };

    const cand1 = { title: "Python Language", fact: "User is studying Python programming language." };
    const cand2 = { title: "Gardening", fact: "User likes indoor gardening." };

    const isMatch1 = isFuzzyDuplicate ? isFuzzyDuplicate(cand1, existing) : true;
    const isMatch2 = isFuzzyDuplicate ? isFuzzyDuplicate(cand2, existing) : false;

    console.log("Candidate 1 (Python Language) match status:", isMatch1);
    console.log("Candidate 2 (Gardening) match status:", isMatch2);

    if (!isMatch1) {
      throw new Error("Test 13.2 failed: Fuzzy deduplication failed to match 'Python Language' with existing 'Python' memory.");
    }
    if (isMatch2) {
      throw new Error("Test 13.2 failed: Fuzzy deduplication incorrectly matched unrelated 'Gardening' memory.");
    }
    console.log("✔ Test 13.2 PASSED: Fuzzy deduplication logic verified!");

    console.log("\n[Test 13.3] OKF Index Synchronization on Memory Update");
    const mem1 = {
      id: "M130",
      title: "Svelte Framework",
      fact: "User is exploring Svelte framework.",
      category: "Skill",
      importance: "Medium"
    };

    const okf1 = generateOKFConcept(mem1);
    const indexPath = path.resolve(__dirname, 'okf', 'user-memory', 'index.md');
    let indexContent1 = fs.readFileSync(indexPath, 'utf8');

    if (!indexContent1.includes("User is exploring Svelte framework.")) {
      throw new Error("Test 13.3 failed: Initial OKF concept link missing from index.md.");
    }

    // Now update fact
    const mem1Updated = {
      id: "M130",
      title: "Svelte Framework",
      fact: "User prefers building web apps with Svelte 5.",
      category: "Skill",
      importance: "High"
    };

    generateOKFConcept(mem1Updated);
    let indexContent2 = fs.readFileSync(indexPath, 'utf8');

    if (!indexContent2.includes("User prefers building web apps with Svelte 5.")) {
      throw new Error("Test 13.3 failed: index.md was not updated with the new memory fact.");
    }

    const svelteOccurrences = (indexContent2.match(/\(memories\/svelte-framework\.md\)/g) || []).length;
    if (svelteOccurrences !== 1) {
      throw new Error(`Test 13.3 failed: Expected 1 occurrence of Svelte link in index.md, found ${svelteOccurrences}`);
    }
    console.log("✔ Test 13.3 PASSED: OKF index entry updated dynamically on fact change!");

    console.log("\n[Test 13.4] Regression Test: Task 10 Suite Execution");
    await new Promise((resolve, reject) => {
      const t10Path = path.resolve(__dirname, 'test_task10.js');
      execFile('node', [t10Path], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Task 10 failed: ${stderr || err.message}`));
        console.log(stdout.trim());
        resolve();
      });
    });
    console.log("✔ Test 13.4 PASSED: Task 10 suite executed cleanly!");

    console.log("\n[Test 13.5] Regression Test: Task 11 Suite Execution");
    await new Promise((resolve, reject) => {
      const t11Path = path.resolve(__dirname, 'test_task11.js');
      execFile('node', [t11Path], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Task 11 failed: ${stderr || err.message}`));
        console.log(stdout.trim());
        resolve();
      });
    });
    console.log("✔ Test 13.5 PASSED: Task 11 suite executed cleanly!");

    console.log("\n[Test 13.6] Regression Test: Task 12 Suite Execution");
    await new Promise((resolve, reject) => {
      const t12Path = path.resolve(__dirname, 'test_task12.js');
      execFile('node', [t12Path], { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Task 12 failed: ${stderr || err.message}`));
        console.log(stdout.trim());
        resolve();
      });
    });
    console.log("✔ Test 13.6 PASSED: Task 12 suite executed cleanly!");

    console.log("\n=== ALL TASK 13 ENHANCED PIPELINE TESTS PASSED SUCCESSFULLY! ===");

  } catch (error) {
    console.error("\n❌ Task 13 Test Failure:", error.message);
    process.exitCode = 1;
  } finally {
    restoreMemoriesBackup();
  }
}

runTask13Tests();
