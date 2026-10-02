const fs = require('fs');
const path = require('path');

const USER_MEMORY_DIR = path.resolve(__dirname, 'user-memory');

const CATEGORY_MAP = {
  Skill: {
    dir: 'skills',
    title: 'Skills',
    description: 'Technical competencies, programming languages, and development tools.'
  },
  Preference: {
    dir: 'preferences',
    title: 'Preferences',
    description: 'User preferences, architectural choices, and coding styles.'
  },
  Project: {
    dir: 'projects',
    title: 'Projects',
    description: 'Active projects, software systems, and application builds.'
  },
  Fact: {
    dir: 'facts',
    title: 'Facts',
    description: 'Biographical facts, environment context, and domain knowledge.'
  },
  General: {
    dir: 'general',
    title: 'General',
    description: 'General knowledge, uncategorized observations, and miscellaneous concepts.'
  }
};

/**
 * Normalizes a title to a clean URL/filesystem slug.
 */
function slugify(text) {
  return (text || 'concept')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'concept';
}

/**
 * Resolves the canonical category config for a memory.
 */
function resolveCategoryConfig(category) {
  const catKey = Object.keys(CATEGORY_MAP).find(
    k => k.toLowerCase() === String(category || '').trim().toLowerCase()
  ) || 'General';
  return { key: catKey, ...CATEGORY_MAP[catKey] };
}

/**
 * Ensures user-memory root and all category subdirectories exist.
 */
function ensureDirectoryStructure() {
  if (!fs.existsSync(USER_MEMORY_DIR)) {
    fs.mkdirSync(USER_MEMORY_DIR, { recursive: true });
  }
  for (const cat of Object.values(CATEGORY_MAP)) {
    const catDir = path.join(USER_MEMORY_DIR, cat.dir);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }
  }
  // Ensure backward-compatibility memories folder exists
  const legacyDir = path.join(USER_MEMORY_DIR, 'memories');
  if (!fs.existsSync(legacyDir)) {
    fs.mkdirSync(legacyDir, { recursive: true });
  }
}

/**
 * Appends a chronological entry to log.md adhering to OKF v0.2 §9.
 * @param {string} action - Action label (Creation, Update, Deprecation, Migration)
 * @param {string} description - Log line description
 */
function appendLogEntry(action, description) {
  try {
    ensureDirectoryStructure();
    const logPath = path.join(USER_MEMORY_DIR, 'log.md');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const entryLine = `* **${action}**: ${description}`;

    let logContent = '';
    if (fs.existsSync(logPath)) {
      logContent = fs.readFileSync(logPath, 'utf8');
    } else {
      logContent = '# Memory Bundle Update Log\n\n';
    }

    const dateHeading = `## ${today}`;
    if (logContent.includes(dateHeading)) {
      // Avoid duplicate exact entry on the same date
      if (!logContent.includes(entryLine)) {
        const parts = logContent.split(dateHeading);
        const updated = `${parts[0]}${dateHeading}\n${entryLine}${parts[1]}`;
        fs.writeFileSync(logPath, updated, 'utf8');
      }
    } else {
      // Prepend new date heading below top header (newest first per §9)
      const headerMatch = logContent.match(/^#\s+[^\n]+\n+/);
      const header = headerMatch ? headerMatch[0] : '# Memory Bundle Update Log\n\n';
      const rest = headerMatch ? logContent.slice(header.length) : logContent;
      const updated = `${header}${dateHeading}\n${entryLine}\n\n${rest.trimStart()}`;
      fs.writeFileSync(logPath, updated.trimEnd() + '\n', 'utf8');
    }
  } catch (err) {
    console.error('Failed to append to log.md:', err.message);
  }
}

/**
 * Finds cross-concept relationships using keyword heuristics.
 * Returns an array of { title, relativeUrl, description }.
 */
function findRelatedConcepts(currentMemory, allMemories = []) {
  if (!Array.isArray(allMemories) || allMemories.length <= 1) return [];

  const currTitle = (currentMemory.title || '').toLowerCase();
  const currFact = (currentMemory.fact || '').toLowerCase();
  const currCat = resolveCategoryConfig(currentMemory.category);
  const currSlug = slugify(currentMemory.title);

  const related = [];

  for (const other of allMemories) {
    if (!other || other.id === currentMemory.id) continue;
    const otherTitle = (other.title || '').toLowerCase();
    const otherFact = (other.fact || '').toLowerCase();
    const otherCat = resolveCategoryConfig(other.category);
    const otherSlug = slugify(other.title);

    if (otherSlug === currSlug) continue;

    let isMatch = false;

    // Direct mention of other title in current fact or title
    if (otherTitle.length >= 3 && (currFact.includes(otherTitle) || currTitle.includes(otherTitle))) {
      isMatch = true;
    }
    // Mention of current title in other fact or title
    else if (currTitle.length >= 3 && (otherFact.includes(currTitle) || otherTitle.includes(currTitle))) {
      isMatch = true;
    }
    // Same category and shared substantial keyword
    else if (currCat.dir === otherCat.dir) {
      const getWords = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
      const currWords = new Set([...getWords(currTitle), ...getWords(currFact)]);
      const otherWords = getWords(otherTitle);
      for (const w of otherWords) {
        if (currWords.has(w)) {
          isMatch = true;
          break;
        }
      }
    }

    if (isMatch) {
      let relPath = '';
      if (currCat.dir === otherCat.dir) {
        relPath = `./${otherSlug}.md`;
      } else {
        relPath = `../${otherCat.dir}/${otherSlug}.md`;
      }

      related.push({
        title: other.title || otherSlug,
        relativeUrl: relPath,
        description: other.fact || ''
      });
      if (related.length >= 5) break;
    }
  }

  return related;
}

/**
 * Loads all active memories from memories.json if available.
 */
function loadAllMemories() {
  try {
    const memFile = path.resolve(__dirname, '..', 'data', 'memories.json');
    if (fs.existsSync(memFile)) {
      return JSON.parse(fs.readFileSync(memFile, 'utf8'));
    }
  } catch (e) {
    // fallback
  }
  return [];
}

/**
 * Generates an OKF v0.2 concept Markdown document from a memory record.
 * @param {Object} memory - Memory object ({ id, title, fact, category, source, created, importance, confidence, privacy })
 * @param {Array} [allMemoriesList] - Optional full list of memories for cross-linking
 * @returns {Object} { path: string, bundlePath: string, content: string, slug: string, category: string }
 */
function generateOKFConcept(memory, allMemoriesList = null) {
  ensureDirectoryStructure();

  const title = memory.title || "Untitled Memory";
  const fact = memory.fact || "";
  const catConfig = resolveCategoryConfig(memory.category);
  const conceptType = `User ${catConfig.key}`;
  const slug = slugify(title);

  const tags = [
    slug,
    catConfig.key.toLowerCase(),
    ...(title.toLowerCase().split(/\s+/).filter(w => w.length > 2 && w !== slug))
  ].filter((v, i, a) => a.indexOf(v) === i);

  const importance = memory.importance || "Medium";
  const privacyTier = memory.privacy || "Protected";
  const confidence = memory.confidence || 95;

  // Actor convention per OKF v0.2 §7
  const actor = (memory.source || '').toLowerCase() === 'manual'
    ? 'human:user'
    : 'okfmem/gemini-2.5-flash';

  const isoTimestamp = new Date().toISOString();

  // Find relationships to other concepts
  const allMemories = allMemoriesList || loadAllMemories();
  const related = findRelatedConcepts(memory, allMemories);

  let relatedSection = '';
  if (related.length > 0) {
    relatedSection = `\n## Related Concepts\n\n${related.map(r => `* [${r.title}](${r.relativeUrl})${r.description ? ` - ${r.description}` : ''}`).join('\n')}\n`;
  }

  // Construct OKF v0.2 Markdown document with YAML frontmatter
  const content = `---
type: ${conceptType}
title: ${title}
description: ${fact}
tags:
${tags.map(t => `  - ${t}`).join('\n')}
generated:
  by: ${actor}
  at: ${isoTimestamp}
status: stable
importance: ${importance}
privacy_tier: ${privacyTier}
confidence: ${confidence}
---

# ${title}

${fact}

## Details
- **Category**: ${catConfig.key}
- **Importance**: ${importance}
- **Privacy Tier**: ${privacyTier}
- **Source**: ${memory.source || 'Conversation'}
${relatedSection}`;

  // Target directory within category subdirectory
  const categoryDir = path.join(USER_MEMORY_DIR, catConfig.dir);
  const conceptPath = path.join(categoryDir, `${slug}.md`);
  fs.writeFileSync(conceptPath, content, 'utf8');

  // Maintain backward-compatibility mirror in memories/ directory for existing tests
  const legacyDir = path.join(USER_MEMORY_DIR, 'memories');
  const legacyPath = path.join(legacyDir, `${slug}.md`);
  try {
    fs.writeFileSync(legacyPath, content, 'utf8');
  } catch (e) {
    // Ignore legacy mirror errors
  }

  // Synchronize Category index.md and Root index.md
  updateCategoryIndex(catConfig.dir);
  updateRootIndex();

  // Record creation/update in log.md
  appendLogEntry('Update', `Synchronized concept [${title}](${catConfig.dir}/${slug}.md) - ${fact}`);

  // Relative path from backend directory (for backward compatibility with tests)
  const relativePath = path.relative(path.join(__dirname, '..'), conceptPath).replace(/\\/g, '/');

  return {
    path: relativePath,
    bundlePath: `${catConfig.dir}/${slug}.md`,
    content: content,
    slug: slug,
    category: catConfig.key
  };
}

/**
 * Regenerates the index.md file for a specific category subdirectory (§8).
 */
function updateCategoryIndex(catDirName) {
  const catKey = Object.keys(CATEGORY_MAP).find(k => CATEGORY_MAP[k].dir === catDirName);
  if (!catKey) return;
  const catConfig = CATEGORY_MAP[catKey];

  const catDirPath = path.join(USER_MEMORY_DIR, catDirName);
  if (!fs.existsSync(catDirPath)) return;

  const files = fs.readdirSync(catDirPath)
    .filter(f => f.endsWith('.md') && f !== 'index.md' && f !== 'log.md');

  const entries = [];
  for (const file of files) {
    const filePath = path.join(catDirPath, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const titleMatch = raw.match(/^title:\s*(.+)$/m) || raw.match(/^#\s+(.+)$/m);
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');
      const desc = descMatch ? descMatch[1].trim() : '';
      entries.push({
        title,
        filename: file,
        description: desc
      });
    } catch (e) {}
  }

  // Sort alphabetically by title
  entries.sort((a, b) => a.title.localeCompare(b.title));

  let indexContent = `# ${catConfig.title} Index\n\n${catConfig.description}\n\n`;
  if (entries.length === 0) {
    indexContent += '_No concepts registered in this category yet._\n';
  } else {
    for (const item of entries) {
      indexContent += `* [${item.title}](${item.filename})${item.description ? ` - ${item.description}` : ''}\n`;
    }
  }

  fs.writeFileSync(path.join(catDirPath, 'index.md'), indexContent, 'utf8');
}

/**
 * Regenerates the root index.md progressive disclosure file (§8 & §12).
 */
function updateRootIndex() {
  ensureDirectoryStructure();
  const rootIndexPath = path.join(USER_MEMORY_DIR, 'index.md');

  let content = `---
okf_version: "0.2"
---

# User Memory Bundle

Personal knowledge bundle maintained by OKFMem adhering to Open Knowledge Format v0.2.

`;

  for (const catKey of Object.keys(CATEGORY_MAP)) {
    const cat = CATEGORY_MAP[catKey];
    const catDirPath = path.join(USER_MEMORY_DIR, cat.dir);
    if (!fs.existsSync(catDirPath)) continue;

    const files = fs.readdirSync(catDirPath)
      .filter(f => f.endsWith('.md') && f !== 'index.md' && f !== 'log.md');

    if (files.length === 0) continue;

    content += `## ${cat.title}\n`;
    content += `* [${cat.title} Index](${cat.dir}/index.md) - ${cat.description}\n`;

    const entries = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(catDirPath, file), 'utf8');
        const titleMatch = raw.match(/^title:\s*(.+)$/m) || raw.match(/^#\s+(.+)$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');
        const desc = descMatch ? descMatch[1].trim() : '';
        entries.push({ title, path: `${cat.dir}/${file}`, description: desc });
      } catch (e) {}
    }

    entries.sort((a, b) => a.title.localeCompare(b.title));
    for (const item of entries) {
      content += `* [${item.title}](${item.path})${item.description ? ` - ${item.description}` : ''}\n`;
    }
    content += '\n';
  }

  fs.writeFileSync(rootIndexPath, content, 'utf8');
}

/**
 * Deletes an OKF concept file and cleans up indexes and log.
 * @param {Object} memory - Memory object with at least title and optional category
 */
function deleteOKFConcept(memory) {
  try {
    if (!memory) return;
    const title = memory.title || "Untitled Memory";
    const slug = slugify(title);
    const catConfig = resolveCategoryConfig(memory.category);

    const catFilePath = path.join(USER_MEMORY_DIR, catConfig.dir, `${slug}.md`);
    if (fs.existsSync(catFilePath)) {
      fs.unlinkSync(catFilePath);
    }

    // Also check and remove from other category dirs in case category changed
    for (const cat of Object.values(CATEGORY_MAP)) {
      const p = path.join(USER_MEMORY_DIR, cat.dir, `${slug}.md`);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    }

    // Remove from legacy mirror
    const legacyPath = path.join(USER_MEMORY_DIR, 'memories', `${slug}.md`);
    if (fs.existsSync(legacyPath)) {
      try { fs.unlinkSync(legacyPath); } catch (e) {}
    }

    // Update indexes
    updateCategoryIndex(catConfig.dir);
    updateRootIndex();

    // Record deprecation in log.md
    appendLogEntry('Deprecation', `Removed concept [${title}] from active bundle`);
  } catch (err) {
    console.error(`Failed to delete OKF concept for memory ${memory.id}:`, err);
  }
}

/**
 * Performs a complete migration of an array of memories into the OKF v0.2 bundle.
 * Idempotent, safe, and clears obsolete test artifacts.
 */
function migrateAllMemories(memoriesList) {
  ensureDirectoryStructure();
  const memories = Array.isArray(memoriesList) ? memoriesList : loadAllMemories();

  // Clean stale concepts in category folders
  const validSlugsByCat = {};
  for (const cat of Object.values(CATEGORY_MAP)) {
    validSlugsByCat[cat.dir] = new Set();
  }

  memories.forEach(m => {
    const cat = resolveCategoryConfig(m.category);
    validSlugsByCat[cat.dir].add(`${slugify(m.title)}.md`);
  });

  for (const cat of Object.values(CATEGORY_MAP)) {
    const catDirPath = path.join(USER_MEMORY_DIR, cat.dir);
    if (fs.existsSync(catDirPath)) {
      const files = fs.readdirSync(catDirPath)
        .filter(f => f.endsWith('.md') && f !== 'index.md' && f !== 'log.md');
      for (const f of files) {
        if (!validSlugsByCat[cat.dir].has(f)) {
          try { fs.unlinkSync(path.join(catDirPath, f)); } catch (e) {}
        }
      }
    }
  }

  // Generate concept for every memory
  for (const mem of memories) {
    generateOKFConcept(mem, memories);
  }

  // Rebuild all indexes
  for (const cat of Object.values(CATEGORY_MAP)) {
    updateCategoryIndex(cat.dir);
  }
  updateRootIndex();

  appendLogEntry('Migration', `Migrated ${memories.length} memories into OKF v0.2 bundle structure`);

  return {
    success: true,
    totalMigrated: memories.length,
    bundlePath: USER_MEMORY_DIR
  };
}

/**
 * Returns structured hierarchy of the entire OKF v0.2 bundle for viewer.
 */
function getOKFBundleTree() {
  ensureDirectoryStructure();

  const tree = {
    bundle: 'user-memory',
    specVersion: '0.2',
    rootFiles: [],
    categories: []
  };

  // Root index and log
  if (fs.existsSync(path.join(USER_MEMORY_DIR, 'index.md'))) {
    tree.rootFiles.push({
      name: 'index.md',
      path: 'index.md',
      type: 'index',
      title: 'Master Bundle Index'
    });
  }
  if (fs.existsSync(path.join(USER_MEMORY_DIR, 'log.md'))) {
    tree.rootFiles.push({
      name: 'log.md',
      path: 'log.md',
      type: 'log',
      title: 'Chronological Update Log'
    });
  }

  // Categories
  for (const catKey of Object.keys(CATEGORY_MAP)) {
    const cat = CATEGORY_MAP[catKey];
    const catDirPath = path.join(USER_MEMORY_DIR, cat.dir);
    if (!fs.existsSync(catDirPath)) continue;

    const files = fs.readdirSync(catDirPath)
      .filter(f => f.endsWith('.md') && f !== 'log.md');

    const catObj = {
      key: catKey,
      dir: cat.dir,
      title: cat.title,
      description: cat.description,
      indexPath: `${cat.dir}/index.md`,
      concepts: []
    };

    for (const f of files) {
      if (f === 'index.md') continue;
      const fullPath = path.join(catDirPath, f);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const titleMatch = raw.match(/^title:\s*(.+)$/m) || raw.match(/^#\s+(.+)$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        const typeMatch = raw.match(/^type:\s*(.+)$/m);
        catObj.concepts.push({
          filename: f,
          slug: f.replace('.md', ''),
          path: `${cat.dir}/${f}`,
          title: titleMatch ? titleMatch[1].trim() : f.replace('.md', ''),
          description: descMatch ? descMatch[1].trim() : '',
          type: typeMatch ? typeMatch[1].trim() : `User ${catKey}`
        });
      } catch (e) {}
    }

    catObj.concepts.sort((a, b) => a.title.localeCompare(b.title));
    tree.categories.push(catObj);
  }

  return tree;
}

/**
 * Safely reads and parses any document within the OKF bundle.
 * Prevents directory traversal attacks.
 */
function readOKFDocument(relativeBundlePath) {
  ensureDirectoryStructure();
  if (!relativeBundlePath || typeof relativeBundlePath !== 'string') {
    return { exists: false, error: 'File path required' };
  }

  // Sanitize path and prevent traversal
  const cleanPath = relativeBundlePath.replace(/^\/+/, '').replace(/\.\.\//g, '');
  const absolutePath = path.resolve(USER_MEMORY_DIR, cleanPath);

  if (!absolutePath.startsWith(USER_MEMORY_DIR) || !fs.existsSync(absolutePath)) {
    return { exists: false, error: 'Document not found' };
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');

  // Parse frontmatter if present
  let frontmatter = {};
  let frontmatterRaw = '';
  let body = raw;

  if (raw.startsWith('---')) {
    const endIdx = raw.indexOf('\n---', 3);
    if (endIdx !== -1) {
      frontmatterRaw = raw.substring(3, endIdx).trim();
      body = raw.substring(endIdx + 4).trimStart();

      frontmatterRaw.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
          const colonIdx = trimmed.indexOf(':');
          if (colonIdx > 0) {
            const key = trimmed.substring(0, colonIdx).trim();
            const val = trimmed.substring(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
            frontmatter[key] = val;
          }
        }
      });
    }
  }

  // Extract links
  const links = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(body)) !== null) {
    links.push({
      text: match[1],
      target: match[2]
    });
  }

  return {
    exists: true,
    path: cleanPath,
    title: frontmatter.title || cleanPath,
    type: frontmatter.type || (cleanPath.endsWith('index.md') ? 'Index' : (cleanPath.endsWith('log.md') ? 'Log' : 'Document')),
    frontmatter,
    frontmatterRaw,
    body,
    content: raw,
    links
  };
}

module.exports = {
  USER_MEMORY_DIR,
  CATEGORY_MAP,
  generateOKFConcept,
  deleteOKFConcept,
  migrateAllMemories,
  getOKFBundleTree,
  readOKFDocument,
  slugify
};
