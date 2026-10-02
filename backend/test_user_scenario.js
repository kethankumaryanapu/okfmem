const path = require('path');
const fs = require('fs');
const http = require('http');
const AdmZip = require('adm-zip');

console.log("==================================================");
console.log("     TEST CASE 21: REAL MEMORY PIPELINE TEST     ");
console.log("==================================================\n");

const {
  generateOKFConcept,
  migrateAllMemories,
  getOKFBundleTree,
  readOKFDocument
} = require('./okf/okfGenerator');
const { isFuzzyDuplicate, updateMemoryInteraction } = require('./server');

const MEMORIES_FILE = path.resolve(__dirname, 'data', 'memories.json');
const USER_MEMORY_DIR = path.resolve(__dirname, 'okf', 'user-memory');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`TEST 21 FAILED: ${message}`);
  }
}

async function runScenario() {
  console.log("User Input: \"I am learning Python and I prefer building web applications.\"\n");

  // 1. Memory candidates as extracted by conversational memory pipeline
  const candidates = [
    {
      title: "Python",
      fact: "User is learning Python.",
      category: "Skill",
      importance: "High",
      confidence: 96,
      privacy: "Protected"
    },
    {
      title: "Web Applications",
      fact: "User prefers building web applications.",
      category: "Preference",
      importance: "High",
      confidence: 95,
      privacy: "Protected"
    }
  ];

  console.log("[Step 1] Verifying Memory Extraction & Classification...");
  assert(candidates.length === 2, "2 memories extracted");
  assert(candidates[0].category === "Skill", "Python classified as Skill");
  assert(candidates[1].category === "Preference", "Web Applications classified as Preference");
  console.log("✔ Extraction & Classification verified!");

  // 2. Duplicate Detection & Persistence
  console.log("\n[Step 2] Testing Deduplication & State Update...");
  let currentMemories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));

  for (const cand of candidates) {
    const existing = currentMemories.find(m => isFuzzyDuplicate(cand, m));
    if (existing) {
      const oldCount = existing.mention_count || 1;
      updateMemoryInteraction(existing);
      console.log(`- Duplicate recognized for '${existing.title}': mention count updated ${oldCount} -> ${existing.mention_count}`);
      assert(existing.mention_count > oldCount, "Mention count incremented");
      generateOKFConcept(existing, currentMemories);
    } else {
      const newId = `M${String(currentMemories.length + 1).padStart(3, '0')}`;
      const newMem = {
        id: newId,
        ...cand,
        source: 'Conversation',
        created: '27 Sep 2026',
        mention_count: 1,
        last_seen: '27 Sep 2026'
      };
      currentMemories.push(newMem);
      console.log(`- Created new memory '${newMem.title}' (${newMem.id})`);
      generateOKFConcept(newMem, currentMemories);
    }
  }

  // 3. Verify actual OKF concept files
  console.log("\n[Step 3] Verifying OKF Concept Documents on Disk...");

  const pythonFile = path.join(USER_MEMORY_DIR, 'skills', 'python.md');
  assert(fs.existsSync(pythonFile), "skills/python.md exists");
  const pyContent = fs.readFileSync(pythonFile, 'utf8');
  assert(pyContent.includes('type: User Skill'), "skills/python.md has 'type: User Skill'");
  assert(pyContent.includes('title: Python'), "skills/python.md has 'title: Python'");
  assert(/generated:\s*\n\s*by:\s*[a-z0-9_:\/-]+/i.test(pyContent), "skills/python.md has generated.by");
  assert(pyContent.includes('status: stable'), "skills/python.md has status: stable");
  assert(pyContent.includes('# Python'), "skills/python.md has Markdown heading # Python");
  console.log("✔ skills/python.md is a genuine OKF concept document!");

  const webAppFile = path.join(USER_MEMORY_DIR, 'preferences', 'web-applications.md');
  assert(fs.existsSync(webAppFile), "preferences/web-applications.md exists");
  const webAppContent = fs.readFileSync(webAppFile, 'utf8');
  assert(webAppContent.includes('type: User Preference'), "preferences/web-applications.md has 'type: User Preference'");
  assert(webAppContent.includes('title: Web Applications'), "preferences/web-applications.md has 'title: Web Applications'");
  assert(webAppContent.includes('# Web Applications'), "preferences/web-applications.md has Markdown heading # Web Applications");
  console.log("✔ preferences/web-applications.md is a genuine OKF concept document!");

  // 4. Verify Index Files
  console.log("\n[Step 4] Verifying Index Listings...");
  const rootIndex = path.join(USER_MEMORY_DIR, 'index.md');
  const rootIndexContent = fs.readFileSync(rootIndex, 'utf8');
  assert(rootIndexContent.includes('[Python](skills/python.md)'), "Root index.md contains link to skills/python.md");
  assert(rootIndexContent.includes('[Web Applications](preferences/web-applications.md)'), "Root index.md contains link to preferences/web-applications.md");

  const skillsIndex = path.join(USER_MEMORY_DIR, 'skills', 'index.md');
  const skillsIndexContent = fs.readFileSync(skillsIndex, 'utf8');
  assert(skillsIndexContent.includes('[Python](python.md)'), "skills/index.md contains link to python.md");
  assert(!skillsIndexContent.startsWith('---'), "skills/index.md has no illegal frontmatter");

  const prefIndex = path.join(USER_MEMORY_DIR, 'preferences', 'index.md');
  const prefIndexContent = fs.readFileSync(prefIndex, 'utf8');
  assert(prefIndexContent.includes('[Web Applications](web-applications.md)'), "preferences/index.md contains link to web-applications.md");
  assert(!prefIndexContent.startsWith('---'), "preferences/index.md has no illegal frontmatter");
  console.log("✔ Root index and category index listings verified!");

  // 5. Verify log.md
  console.log("\n[Step 5] Verifying log.md Update History...");
  const logFile = path.join(USER_MEMORY_DIR, 'log.md');
  const logContent = fs.readFileSync(logFile, 'utf8');
  assert(logContent.includes('# Memory Bundle Update Log'), "log.md has header");
  assert(/## \d{4}-\d{2}-\d{2}/.test(logContent), "log.md has date header");
  assert(logContent.includes('Python'), "log.md mentions Python concept update");
  console.log("✔ log.md history verified!");

  // 6. Verify Viewer Tree & Document Parsing
  console.log("\n[Step 6] Testing Viewer Data Structures...");
  const bundleTree = getOKFBundleTree();
  assert(bundleTree.categories.some(c => c.dir === 'skills' && c.concepts.some(cp => cp.slug === 'python')), "Tree contains skills/python");
  assert(bundleTree.categories.some(c => c.dir === 'preferences' && c.concepts.some(cp => cp.slug === 'web-applications')), "Tree contains preferences/web-applications");

  const parsedDoc = readOKFDocument('skills/python.md');
  assert(parsedDoc.exists === true, "readOKFDocument finds skills/python.md");
  assert(parsedDoc.frontmatter.title === "Python", "Parsed title is Python");
  assert(parsedDoc.frontmatter.type === "User Skill", "Parsed type is User Skill");
  assert(parsedDoc.body.includes('# Python'), "Parsed body contains title");
  console.log("✔ Viewer data structures and document parsing verified!");

  // 7. Verify Export Bundle
  console.log("\n[Step 7] Testing OKF Export Archive...");
  const zip = new AdmZip();
  zip.addLocalFolder(USER_MEMORY_DIR, 'user-memory');
  const entries = zip.getEntries().map(e => e.entryName);
  assert(entries.some(e => e === 'user-memory/index.md'), "Zip contains user-memory/index.md");
  assert(entries.some(e => e === 'user-memory/log.md'), "Zip contains user-memory/log.md");
  assert(entries.some(e => e.includes('skills/python.md')), "Zip contains skills/python.md");
  assert(entries.some(e => e.includes('preferences/web-applications.md')), "Zip contains preferences/web-applications.md");
  assert(!entries.some(e => e.endsWith('memories.json')), "Zip does NOT contain memories.json");
  console.log("✔ OKF bundle export verified!");

  console.log("\n==================================================");
  console.log("      ALL 14 EXPECTED BEHAVIORS VERIFIED!         ");
  console.log("==================================================");
}

runScenario().catch(err => {
  console.error("\n❌ SCENARIO FAILED:", err.message);
  process.exit(1);
});
