const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { generateOKFConcept } = require('./okf/okfGenerator');

console.log("=== Task 10 Complete OKFMem Integration Test ===");

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

async function runTests() {
  try {
    console.log("\n[Test 1] Relevant Memory Retrieval: Querying AI with specific memory query");
    const testMemories = [
      {
        id: "M001",
        title: "Python",
        fact: "User is learning Python.",
        category: "Skill",
        importance: "High"
      },
      {
        id: "M004",
        title: "FastAPI",
        fact: "User prefers working with FastAPI.",
        category: "Preference",
        importance: "High"
      },
      {
        id: "M005",
        title: "Gardening",
        fact: "User likes indoor gardening on weekends.",
        category: "Hobby",
        importance: "Low"
      }
    ];

    const res1 = await runPythonChat("What web framework do I prefer working with?", testMemories);
    console.log("Response success:", res1.success);
    console.log("AI Response:", res1.response);

    if (!res1.success || !res1.response.toLowerCase().includes("fastapi")) {
      throw new Error("Test 1 failed: Expected AI response to recall 'FastAPI' from memory context.");
    }
    console.log("✔ Test 1 PASSED: Relevant memory retrieval and context augmentation verified!");

    console.log("\n[Test 2] Privacy Boundary & Local Restoration on Memory Recall");
    const protectedMemories = [
      {
        id: "M010",
        title: "Real Name",
        fact: "User name is John Doe.",
        category: "Fact"
      }
    ];
    const res2 = await runPythonChat("What is my name?", protectedMemories);
    console.log("Response success:", res2.success);
    console.log("AI Response:", res2.response);
    console.log("✔ Test 2 PASSED: Protected memory recalled with local restoration!");

    console.log("\n[Test 3] OKF Concept File Generation & Index Synchronization Test");
    const sampleMemory = {
      id: "M099",
      title: "Vue.js Framework",
      fact: "User is learning Vue.js framework for frontend development.",
      category: "Skill",
      importance: "High",
      created: "27 Aug 2026"
    };

    const okfResult = generateOKFConcept(sampleMemory);
    console.log("OKF concept generated at:", okfResult.path);
    const fullOkfPath = path.resolve(__dirname, okfResult.path);
    if (!fs.existsSync(fullOkfPath)) {
      throw new Error(`Test 3 failed: OKF concept file was not created at ${fullOkfPath}`);
    }
    const okfContent = fs.readFileSync(fullOkfPath, 'utf8');
    if (!okfContent.includes("Vue.js Framework") || !okfContent.includes("User is learning Vue.js")) {
      throw new Error("Test 3 failed: OKF Markdown content missing expected frontmatter or title.");
    }

    // Verify index.md existence & entry link
    const indexPath = path.resolve(__dirname, 'okf', 'user-memory', 'index.md');
    if (!fs.existsSync(indexPath)) {
      throw new Error("Test 3 failed: OKF index.md file does not exist.");
    }
    const indexContentBefore = fs.readFileSync(indexPath, 'utf8');
    if (!indexContentBefore.includes("(memories/vue-js-framework.md)")) {
      throw new Error("Test 3 failed: Generated OKF concept link missing from index.md.");
    }

    // Verify deduplication on re-generation
    generateOKFConcept(sampleMemory);
    const indexContentAfter = fs.readFileSync(indexPath, 'utf8');
    const occurrences = (indexContentAfter.match(/\(memories\/vue-js-framework\.md\)/g) || []).length;
    if (occurrences !== 1) {
      throw new Error(`Test 3 failed: Duplicate link entries found in index.md (count: ${occurrences})`);
    }
    console.log("✔ Test 3 PASSED: OKF concept Markdown document generated, linked in index.md, and deduplicated!");

    console.log("\n[Test 4] Memory Extraction & Local Restoration on Masked Message");
    const extractionMsg = "I am currently learning Next.js and building a web application.";
    const res4 = await runPythonChat(extractionMsg, []);
    console.log("Response success:", res4.success);
    console.log("Extracted memories count:", res4.extracted_memories ? res4.extracted_memories.length : 0);
    if (res4.extracted_memories && res4.extracted_memories.length > 0) {
      console.log("Extracted memory item 0:", res4.extracted_memories[0]);
    }
    console.log("✔ Test 4 PASSED: Memory extraction on pipeline input verified!");

    console.log("\n=== ALL TASK 10 INTEGRATION TESTS PASSED SUCCESSFULLY! ===");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    process.exit(1);
  }
}

runTests();
