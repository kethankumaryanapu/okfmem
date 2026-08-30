const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { generateOKFConcept } = require('./okf/okfGenerator');

const DATA_DIR = path.resolve(__dirname, 'data');
const MEMORIES_FILE = path.resolve(DATA_DIR, 'memories.json');
const SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json');

const defaultSettings = {
  memoryEnabled: true,
  autoSaveMemories: true,
  allowedCategories: ["Skill", "Preference", "Project", "Fact", "General"],
  privacyMode: "Protected"
};

function loadSettings() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2), 'utf8');
      return { ...defaultSettings };
    }
    const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return { ...defaultSettings, ...JSON.parse(data) };
  } catch (err) {
    console.error('Error reading settings.json:', err);
    return { ...defaultSettings };
  }
}

function saveSettings(settingsObj) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsObj, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing settings.json:', err);
  }
}

let userSettings = loadSettings();

const defaultMemories = [
  {
    id: "M001",
    title: "Python",
    fact: "User is learning Python.",
    category: "Skill",
    importance: "High",
    confidence: 96,
    privacy: "Protected",
    source: "Conversation",
    created: "24 Aug 2026"
  },
  {
    id: "M002",
    title: "AI Project",
    fact: "User is working on an AI project.",
    category: "Project",
    importance: "High",
    confidence: 94,
    privacy: "Safe",
    source: "Conversation",
    created: "24 Aug 2026"
  },
  {
    id: "M003",
    title: "Async/Await",
    fact: "User prefers async/await structures.",
    category: "Preference",
    importance: "Medium",
    confidence: 92,
    privacy: "Safe",
    source: "Conversation",
    created: "23 Aug 2026"
  }
];

function loadMemories() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(MEMORIES_FILE)) {
      fs.writeFileSync(MEMORIES_FILE, JSON.stringify(defaultMemories, null, 2), 'utf8');
      return [...defaultMemories];
    }
    const data = fs.readFileSync(MEMORIES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading memories.json:', err);
    return [...defaultMemories];
  }
}

function saveMemories(memList) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(MEMORIES_FILE, JSON.stringify(memList, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing memories.json:', err);
  }
}

let memories = loadMemories();

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'OKFMem backend is running'
  });
});

app.get('/api/settings', (req, res) => {
  res.json({
    success: true,
    settings: userSettings
  });
});

app.post('/api/settings', (req, res) => {
  try {
    const newSettings = req.body || {};
    userSettings = {
      ...userSettings,
      ...newSettings
    };
    saveSettings(userSettings);
    res.json({
      success: true,
      settings: userSettings
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/memories', (req, res) => {
  res.json({
    success: true,
    memories: memories
  });
});


function deleteOKFConcept(memory) {
  try {
    if (!memory) return;
    const title = memory.title || "Untitled Memory";
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'memory';
    const relPath = `memories/${slug}.md`;
    const memoriesDir = path.resolve(__dirname, 'okf', 'user-memory', 'memories');
    const filePath = path.resolve(memoriesDir, `${slug}.md`);

    if (filePath.startsWith(memoriesDir) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const indexPath = path.resolve(__dirname, 'okf', 'user-memory', 'index.md');
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, 'utf8');
      const targetPattern = new RegExp(`^\\* \\[.*?\\]\\(${relPath.replace('.', '\\.')}\\).*$\\n?`, 'm');
      if (targetPattern.test(indexContent)) {
        const updatedContent = indexContent.replace(targetPattern, '');
        fs.writeFileSync(indexPath, updatedContent, 'utf8');
      }
    }
  } catch (err) {
    console.error(`Failed to delete OKF concept for memory ${memory.id}:`, err);
  }
}

app.delete('/api/memories/:id', (req, res) => {
  try {
    const memoryId = req.params.id;
    if (!memoryId) {
      return res.status(400).json({ success: false, error: 'Memory ID is required' });
    }

    const index = memories.findIndex(m => m.id === memoryId);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Memory not found' });
    }

    const [deletedMemory] = memories.splice(index, 1);
    saveMemories(memories);

    deleteOKFConcept(deletedMemory);

    res.json({
      success: true,
      message: 'Memory deleted successfully',
      id: memoryId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.post('/api/okf/generate', (req, res) => {
  try {
    const memory = req.body;
    if (!memory || !memory.title) {
      return res.status(400).json({ success: false, error: "Invalid memory object" });
    }

    const result = generateOKFConcept(memory);
    res.json({
      success: true,
      message: "OKF concept generated",
      path: result.path
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/okf/memories/:filename', (req, res) => {
  try {
    const rawFilename = req.params.filename;
    const safeFilename = path.basename(rawFilename);
    const memoriesDir = path.resolve(__dirname, 'okf', 'user-memory', 'memories');
    const filePath = path.resolve(memoriesDir, safeFilename);

    if (!filePath.startsWith(memoriesDir) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'OKF memory document not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/okf/export', (req, res) => {
  try {
    const zip = new AdmZip();
    const targetDir = path.resolve(__dirname, 'okf', 'user-memory');

    if (!fs.existsSync(targetDir)) {
      return res.status(404).json({ success: false, error: 'OKF bundle directory not found' });
    }

    zip.addLocalFolder(targetDir, 'user-memory');
    const buffer = zip.toBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="okfmem-user-memory.zip"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const { execFile } = require('child_process');

function runMemPrivacyService(text) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');

    execFile(pythonPath, [scriptPath, text], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`MemPrivacy execution error: ${stderr || error.message}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Invalid response from MemPrivacy service: ${stdout}`));
      }
    });
  });
}

function runMemPrivacyChat(text, memoriesList = [], settingsObj = null) {
  return new Promise((resolve, reject) => {
    const pythonPath = 'python';
    const scriptPath = path.resolve(__dirname, 'memprivacy', 'service.py');
    const jsonMemories = JSON.stringify(memoriesList || []);
    const jsonSettings = JSON.stringify(settingsObj || userSettings || {});

    execFile(pythonPath, [scriptPath, 'chat', text, jsonMemories, jsonSettings], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`MemPrivacy execution error: ${stderr || error.message}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Invalid response from MemPrivacy chat service: ${stdout}`));
      }
    });
  });
}

function getFormattedDate() {
  const date = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function isFuzzyDuplicate(cand, existingMem) {
  const normTitle = (cand.title || '').trim().toLowerCase();
  const normFact = (cand.fact || '').trim().toLowerCase();
  const mTitle = (existingMem.title || '').trim().toLowerCase();
  const mFact = (existingMem.fact || '').trim().toLowerCase();

  if (!normTitle && !normFact) return false;

  // 1. Exact title or fact match
  if ((normTitle && mTitle === normTitle) || (normFact && mFact === normFact)) {
    return true;
  }

  // 2. Title substring containment match (for titles >= 3 chars)
  if (normTitle && mTitle && normTitle.length >= 3 && mTitle.length >= 3) {
    if (mTitle.includes(normTitle) || normTitle.includes(mTitle)) {
      return true;
    }
  }

  // 3. Fact key term overlap match
  const stopwords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'about', 'user',
    'and', 'or', 'my', 'i', 'am', 'working', 'learning', 'prefers', 'likes'
  ]);

  const getTokens = (text) => {
    return new Set(
      (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9_#+.\-<>]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2 && !stopwords.has(t))
    );
  };

  const tokens1 = getTokens(normFact);
  const tokens2 = getTokens(mFact);

  if (tokens1.size > 0 && tokens2.size > 0) {
    let matchCount = 0;
    for (const t of tokens1) {
      if (tokens2.has(t)) matchCount++;
    }
    const minSize = Math.min(tokens1.size, tokens2.size);
    if (minSize > 0 && (matchCount / minSize) >= 0.7) {
      return true;
    }
  }

  return false;
}

function updateMemoryInteraction(mem) {
  mem.mention_count = (mem.mention_count || 1) + 1;
  mem.last_seen = getFormattedDate();

  // Task 11 Adaptive Importance Promotion Rules:
  // - Low + mention_count >= 2 -> Medium
  // - Medium + mention_count >= 3 -> High
  // - High remains High
  const currentImp = (mem.importance || 'Medium').trim().toLowerCase();
  if (currentImp === 'low' && mem.mention_count >= 2) {
    mem.importance = 'Medium';
  } else if (currentImp === 'medium' && mem.mention_count >= 3) {
    mem.importance = 'High';
  }

  try {
    generateOKFConcept(mem);
  } catch (okfErr) {
    console.error(`Failed to update OKF concept for memory ${mem.id}:`, okfErr);
  }

  return mem;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { text, message } = req.body || {};
    const inputMessage = text || message;
    if (!inputMessage || typeof inputMessage !== 'string') {
      return res.status(400).json({ success: false, error: 'Message input text is required' });
    }

    const result = await runMemPrivacyChat(inputMessage, memories, userSettings);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'MemPrivacy processing failed'
      });
    }

    const createdMemories = [];

    // Task 15 Memory Control & Rules
    // 15.1: If memoryEnabled is OFF, do not extract or persist new memories
    // 15.2: Filter by allowedCategories before persisting
    // 15.1: If autoSaveMemories is OFF, do not persist newly extracted memories
    if (userSettings.memoryEnabled && Array.isArray(result.extracted_memories) && result.extracted_memories.length > 0) {
      const allowedCats = (userSettings.allowedCategories || []).map(c => String(c).trim().toLowerCase());

      for (const cand of result.extracted_memories) {
        const normTitle = (cand.title || '').trim().toLowerCase();
        const normFact = (cand.fact || '').trim().toLowerCase();
        const candCat = (cand.category || 'Skill').trim().toLowerCase();

        if (!normTitle && !normFact) continue;

        // Check if candidate category is allowed (15.2)
        if (allowedCats.length > 0 && !allowedCats.includes(candCat)) {
          continue;
        }

        // Check for duplicates in existing memories array (Task 13 Fuzzy Deduplication)
        const existingMem = memories.find(m => isFuzzyDuplicate(cand, m));

        if (existingMem) {
          // Task 11: Increment mention_count, update last_seen, promote importance if threshold reached
          updateMemoryInteraction(existingMem);
        } else if (userSettings.autoSaveMemories) {
          // Auto-Save ON (15.1): Persist newly extracted memory
          const maxNum = memories.reduce((max, item) => {
            const num = parseInt((item.id || '').replace(/^M0*/, ''), 10);
            return !isNaN(num) && num > max ? num : max;
          }, 0);

          const nextId = `M${String(maxNum + 1).padStart(3, '0')}`;

          const newMem = {
            id: nextId,
            title: cand.title || 'Untitled Memory',
            fact: cand.fact || '',
            category: cand.category || 'Skill',
            importance: cand.importance || 'High',
            confidence: typeof cand.confidence === 'number' ? cand.confidence : 94,
            privacy: cand.privacy || 'Safe',
            source: 'Conversation',
            created: getFormattedDate(),
            mention_count: 1,
            last_seen: getFormattedDate()
          };

          memories.push(newMem);
          createdMemories.push(newMem);

          // Automatically generate OKF Concept document for the extracted memory
          try {
            generateOKFConcept(newMem);
          } catch (okfErr) {
            console.error(`Failed to generate OKF concept for memory ${newMem.id}:`, okfErr);
          }
        }
      }

      if (createdMemories.length > 0) {
        saveMemories(memories);
      }
    }

    res.json({
      success: true,
      response: result.response,
      used_memories: result.used_memories || [],
      extracted_memories: createdMemories,
      provider: result.provider || 'offline'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'An internal error occurred while processing the chat message'
    });
  }
});

app.post('/api/privacy/test', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Text input string is required' });
    }

    const result = await runMemPrivacyService(text);
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json({
      success: true,
      original: result.original,
      masked: result.masked,
      restored: result.restored
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`OKFMem backend running at http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  isFuzzyDuplicate,
  updateMemoryInteraction
};
