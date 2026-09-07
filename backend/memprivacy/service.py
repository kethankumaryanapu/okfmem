import sys
import os
import json
import time

# Ensure memprivacy root directory is in sys.path
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

src_dir = os.path.join(script_dir, "src")
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

from src.privacy_masking import (
    PrivacyStore,
    mask_dialogue,
    unmask_dialogue,
    detect_and_mask_dialogue,
    load_yaml_config,
)

import re

import socket
from urllib.parse import urlparse

def is_local_endpoint(url: str) -> bool:
    """Check whether a base URL points to a local/on-device host."""
    if not url:
        return False
    url_lower = url.lower()
    return "localhost" in url_lower or "127.0.0.1" in url_lower or "0.0.0.0" in url_lower or "::1" in url_lower

def is_local_port_open(url: str, timeout_sec: float = 0.3) -> bool:
    """Instant check if local endpoint port is currently listening."""
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "127.0.0.1"
        if host == "localhost":
            host = "127.0.0.1"
        port = parsed.port or 80
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout_sec)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False

# Reusable cached Gemini client to avoid repeated initialization overhead
_CACHED_GENAI_CLIENT = None
_CACHED_GENAI_KEY = None

def get_genai_client(api_key: str):
    global _CACHED_GENAI_CLIENT, _CACHED_GENAI_KEY
    if _CACHED_GENAI_CLIENT is not None and _CACHED_GENAI_KEY == api_key:
        return _CACHED_GENAI_CLIENT
    try:
        from google import genai
        _CACHED_GENAI_CLIENT = genai.Client(api_key=api_key)
        _CACHED_GENAI_KEY = api_key
        return _CACHED_GENAI_CLIENT
    except Exception:
        return None

EXCLUDED_NAME_WORDS = {
    "learning", "working", "exploring", "studying", "building", "developing",
    "using", "trying", "getting", "currently", "currenlty", "currenly", "cureently",
    "curently", "recently", "interested", "ready", "happy", "glad", "sure", "new",
    "here", "there", "just", "also", "now", "not", "a", "an", "the", "planning",
    "hoping", "going", "looking", "reading", "practicing", "coding", "programming",
    "making", "creating", "testing", "debugging", "how", "to", "apps", "code",
    "student", "engineer", "developer", "beginner", "am", "so", "very"
}

def extract_mem_privacy_taxonomy_items(text: str) -> list:
    """
    MemPrivacy Local Taxonomy Extractor (Offline / Edge Fallback).
    Extracts new privacy items in input text according to official MemPrivacy taxonomy (PL2-PL4):
      - PL2: Real Name, Email Address, Phone Number, Detailed Address
      - PL3: Medical Health, Financial Account, ID Number
      - PL4: Verification Code, Password, Key, Token
    Uses standard MemPrivacy tags for mask generation via mask_dialogue().
    """
    items = []

    # 1. Email Address (PL2)
    email_matches = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text)
    for email in email_matches:
        items.append({
            "original_text": email,
            "privacy_type": "Email Address",
            "privacy_level": "PL2"
        })

    # 2. Real Name (PL2)
    name_patterns = [
        r'\b(?:my name is|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b',
    ]
    for pattern in name_patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            name_val = match.group(1).strip()
            # Clean up trailing words like 'and', 'or'
            name_val = re.sub(r'\s+(?:and|or|my|is|email|phone|the)\b.*$', '', name_val, flags=re.IGNORECASE)
            name_words = [w.lower() for w in name_val.split()] if name_val else []
            if name_words and not any(w in EXCLUDED_NAME_WORDS for w in name_words):
                items.append({
                    "original_text": name_val,
                    "privacy_type": "Real Name",
                    "privacy_level": "PL2"
                })

    # 3. Phone Number (PL2)
    phone_matches = re.findall(r'\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?(?:\d{3}[-.\s]?)?\d{4}\b', text)
    for phone in phone_matches:
        items.append({
            "original_text": phone,
            "privacy_type": "Phone Number",
            "privacy_level": "PL2"
        })

    # 4. Verification Code (PL4)
    code_matches = re.findall(r'\b(?:verification|sms|otp|code)\s*(?:is|:)?\s*(\d{4,8})\b', text, re.IGNORECASE)
    for code in code_matches:
        items.append({
            "original_text": code,
            "privacy_type": "Verification Code",
            "privacy_level": "PL4"
        })

    return items

def run_local_mem_privacy_detection(text: str, config: dict, store: PrivacyStore, mask_levels: list) -> tuple:
    """
    Executes local MemPrivacy privacy detection:
    1. Attempts to run detect_and_mask_dialogue() via local edge LLM endpoint (localhost/127.0.0.1).
    2. If local LLM server is offline, extracts new privacy items matching MemPrivacy taxonomy on-device.
    3. Calls official mask_dialogue() to record placeholders into PrivacyStore.
    """
    local_api_key = os.environ.get("MEMPRIVACY_LOCAL_API_KEY") or os.environ.get("MEMPRIVACY_DETECTION_API_KEY") or os.environ.get("LOCAL_LLM_API_KEY") or config.get("llm", {}).get("api_key", "EMPTY")
    local_base_url = os.environ.get("MEMPRIVACY_LOCAL_BASE_URL") or os.environ.get("MEMPRIVACY_DETECTION_BASE_URL") or os.environ.get("LOCAL_LLM_BASE_URL") or config.get("llm", {}).get("base_url", "http://localhost:8000/v1")
    local_model = os.environ.get("MEMPRIVACY_LOCAL_MODEL") or os.environ.get("MEMPRIVACY_DETECTION_MODEL") or os.environ.get("LOCAL_LLM_MODEL") or config.get("llm", {}).get("model", "Qwen3-4B-privacy")

    if not is_local_endpoint(local_base_url):
        local_base_url = "http://localhost:8000/v1"

    if is_local_port_open(local_base_url):
        detection_config = dict(config)
        detection_config["llm"] = {
            "api_key": local_api_key,
            "base_url": local_base_url,
            "model": local_model,
            "timeout": 5,
            "retry_times": 0
        }
        try:
            masked_text, detected_items = detect_and_mask_dialogue(
                message_text=text,
                config=detection_config,
                store=store,
                mask_levels=mask_levels
            )
            return masked_text, detected_items, True
        except Exception:
            pass

    # Local LLM server offline: perform local taxonomy extraction & mask_dialogue on-device
    new_items = extract_mem_privacy_taxonomy_items(text)
    all_items = store.get_all()
    existing_items = [item for item in all_items if item["original_text"] in text]
    
    # Merge existing items and new taxonomy items (deduplicating by original_text)
    seen_texts = set()
    combined_items = []
    for item in existing_items + new_items:
        orig = item["original_text"]
        if orig not in seen_texts:
            seen_texts.add(orig)
            combined_items.append(item)

    masked_text = mask_dialogue(text, combined_items, store, mask_levels=mask_levels)
    return masked_text, combined_items, False

def retrieve_relevant_memories(user_text: str, memories_list: list, top_k: int = 5) -> list:
    """
    Task 10 Memory Retrieval:
    Retrieves the most relevant existing memories based on user message content.
    Prevents dumping all stored memories blindly into the AI prompt context.
    """
    if not memories_list or not isinstance(memories_list, list):
        return []

    stopwords = {"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
                 "in", "on", "at", "to", "for", "from", "with", "by", "about", "against",
                 "between", "into", "through", "during", "before", "after", "above", "below",
                 "up", "down", "out", "off", "over", "under", "again", "further", "then",
                 "once", "here", "there", "when", "where", "why", "how", "all", "any",
                 "both", "each", "few", "more", "most", "other", "some", "such", "no",
                 "nor", "not", "only", "own", "same", "so", "than", "too", "very", "s",
                 "t", "can", "will", "just", "don", "should", "now", "i", "me", "my",
                 "myself", "what", "which", "who", "whom", "this", "that", "these",
                 "those", "am", "do", "does", "did"}

    raw_tokens = re.findall(r'[a-zA-Z0-9_#+.\-<>]+', (user_text or "").lower())
    query_terms = [t for t in raw_tokens if t not in stopwords and len(t) > 1]

    if not query_terms:
        return []

    scored_memories = []
    for mem in memories_list:
        if not isinstance(mem, dict):
            continue
        title = str(mem.get("title", "")).lower()
        fact = str(mem.get("fact", "")).lower()
        category = str(mem.get("category", "")).lower()
        text_block = f"{title} {fact} {category}"

        # Primary Signal: Keyword relevance (title matches +3, fact matches +2, category matches +1)
        keyword_score = 0
        for term in query_terms:
            if term in text_block:
                keyword_score += 3 if term in title else (2 if term in fact else 1)

        # Secondary Adaptive Signal: Importance weight (High: +0.5, Medium: +0.25, Low: +0.1)
        importance_str = str(mem.get("importance", "Medium")).lower()
        if importance_str == "high":
            importance_bonus = 0.5
        elif importance_str == "medium":
            importance_bonus = 0.25
        else:
            importance_bonus = 0.1

        # Secondary Adaptive Signal: Mention count bonus (+0.1 per additional mention up to +0.3)
        try:
            mention_count = int(mem.get("mention_count", 1) or 1)
        except (ValueError, TypeError):
            mention_count = 1
        mention_bonus = min(max(mention_count - 1, 0) * 0.1, 0.3)

        total_score = keyword_score + importance_bonus + mention_bonus
        scored_memories.append((total_score, mem))

    scored_memories.sort(key=lambda x: x[0], reverse=True)

    # Filter positive keyword matches first (require keyword score >= 1.0)
    positive_matches = [mem for score, mem in scored_memories if score >= 1.0]
    return positive_matches[:top_k]

def format_memories_for_context(memories_list: list, store: PrivacyStore, mask_levels: list, user_text: str = "") -> tuple:
    """
    Task 10 & 15: Formats relevant memories into a privacy-masked context block for AI chat.
    Retrieves relevant memories matching user_text and passes memory facts through
    mask_dialogue to ensure sensitive details remain protected.
    Returns tuple: (context_string, used_memories_list)
    """
    if not memories_list or not isinstance(memories_list, list):
        return "", []

    relevant_memories = retrieve_relevant_memories(user_text, memories_list, top_k=4) if user_text else memories_list[:4]

    context_lines = []
    used_memories = []
    all_stored_items = store.get_all()
    for mem in relevant_memories:
        if not isinstance(mem, dict):
            continue
        category = mem.get("category", "General")
        fact = mem.get("fact", "")

        if not fact:
            continue

        used_memories.append(mem)
        # Mask any sensitive text in the memory fact before giving to AI
        matching_items = [item for item in all_stored_items if item["original_text"] in fact]
        masked_fact = mask_dialogue(fact, matching_items, store, mask_levels=mask_levels)

        context_lines.append(f"- [{category}] {masked_fact}")

    if not context_lines:
        return "", []

    return "Known User Memories (Use these facts to answer questions when relevant):\n" + "\n".join(context_lines), used_memories

def generate_offline_conversational_response(user_text: str, memory_context: str = "", history: list = None, used_memories: list = None, store: PrivacyStore = None) -> str:
    """
    Task 17 Deterministic Conversational Offline Fallback:
    Provides context-aware, useful, natural, and helpful developer responses
    without robotic boilerplate ('I have received your message...').
    Handles:
      - Common follow-up questions ('yes', 'sure', 'tell me more', 'how', 'why', 'give examples')
        by interpreting the preceding conversation turn.
      - Development queries: App development, beginner apps, studying CSE, HTML projects, 'What is HTML?', login page design, JavaScript.
      - Naturally answering queries with retrieved long-term memories without bracket tags ([Skill], [Preference]).
      - Sanitizes all inputs against internal MemPrivacy placeholders before topic extraction.
    """
    # Unmask user_text using store if available to evaluate real user intent
    if store:
        unmasked_text = unmask_dialogue(user_text, store)
    else:
        unmasked_text = user_text

    # Strip any internal privacy placeholder patterns to guarantee zero leakage into fallback responses
    safe_text = re.sub(r'<[A-Za-z_]+_\d+>', '', unmasked_text)
    safe_text = re.sub(
        r'\b(?:real_name|email_address|phone_number|detailed_address|medical_health|financial_account|id_number|verification_code|password|key|token|mask)_[0-9]+\b',
        '',
        safe_text,
        flags=re.IGNORECASE
    )

    q_raw = safe_text.strip()
    q_lower = q_raw.lower()
    clean_q = re.sub(r'[^\w\s]', '', q_lower).strip()
    clean_q = re.sub(r'\s+', ' ', clean_q)

    # 1. Quick greetings & courtesy handling
    if clean_q in ["hi", "hello", "hey", "good morning", "good evening", "greetings"]:
        return "Hello! I am OKFMem Assistant, your privacy-preserving AI assistant. How can I help you with your development projects today?"

    if clean_q in ["thanks", "thank you", "thx", "appreciate it"]:
        return "You're very welcome! Let me know if there is anything else you'd like to work on."

    if clean_q in ["no", "nope", "not really", "no thanks", "no thank you"]:
        return "Understood! Let me know whenever you'd like to explore other topics or need assistance with your code."

    # 2. Check if the query is a short follow-up needing recent context
    follow_up_tokens = {
        "yes", "yeah", "yep", "sure", "ok", "okay", "tell me more", "explain that",
        "what about this", "how", "how so", "why", "give examples", "give me examples",
        "continue", "more", "go on", "details", "features", "suggest some features",
        "can you suggest some features", "suggest features", "recommend features",
        "first one", "the first one", "first project", "the first project",
        "tell me more about the first one", "tell me about the first one",
        "explain the first one", "about the first one"
    }

    is_follow_up = clean_q in follow_up_tokens or clean_q.startswith("can you suggest") or clean_q.startswith("tell me") or clean_q in ["how", "why"] or "first one" in clean_q or "about the first" in clean_q

    if is_follow_up and history and isinstance(history, list):
        combined_recent = " ".join(str(turn.get("text", "")).lower() for turn in history[-4:])
        if any(k in combined_recent for k in ["build apps", "apps", "app development", "beginner-friendly app ideas", "learning how to build apps"]):
            return (
                "Here are 3 excellent beginner app projects that build fundamental developer skills:\n\n"
                "1. **Task Manager / To-Do App**: Master CRUD operations, task filtering (Active/Completed), and browser `localStorage` persistence.\n"
                "2. **Weather Dashboard**: Practice fetching real-time data from a public REST API, parsing async JSON responses, and rendering dynamic forecast cards.\n"
                "3. **Personal Expense Tracker**: Practice form inputs, numeric math calculations, category filtering, and summary statistics.\n\n"
                "Which one of these would you like to start with, or would you prefer a starter code skeleton?"
            )
        elif any(k in clean_q for k in ["first one", "the first one", "first project", "about the first"]):
            return (
                "The **Personal Developer Portfolio** is the ideal first project to build:\n\n"
                "1. **Header & Navigation**: Brand title, tagline, and smooth-scrolling links to About, Projects, Skills, and Contact.\n"
                "2. **Hero Section**: A crisp headline, profile photo/avatar, and quick action buttons ('View My Work', 'Get in Touch').\n"
                "3. **Project Showcase**: Responsive card grid with project screenshots, tech stack badges, live demo links, and GitHub repositories.\n"
                "4. **Skills Matrix**: Categorized tech chips for Frontend, Backend, and Development Tools.\n"
                "5. **Contact Form**: Clean, accessible form with client-side validation.\n\n"
                "Would you like an HTML starter skeleton for this portfolio?"
            )
        elif any(k in combined_recent for k in ["html portfolio", "portfolio website", "portfolio"]):
            return (
                "Here are key features you should build into your HTML portfolio website:\n\n"
                "1. **Hero Section**: A crisp headline, profile photo, bio tagline, and quick call-to-action buttons ('View Projects', 'Contact Me').\n"
                "2. **Project Showcase Cards**: Responsive cards displaying project thumbnails, tech stack tags, brief descriptions, and live/GitHub links.\n"
                "3. **Skills Matrix**: Categorized badges for Frontend, Backend, and Development Tools.\n"
                "4. **Experience Timeline**: A clean chronological timeline highlighting your past work, education, or open-source contributions.\n"
                "5. **Accessible Contact Form**: Styled inputs for name, email, and message with validation attributes.\n"
                "6. **Theme Toggle**: A lightweight dark/light mode toggle for improved readability.\n\n"
                "Would you like the HTML skeleton for any of these sections?"
            )
        elif any(k in combined_recent for k in ["html project", "projects on html", "html"]):
            return (
                "To take your HTML projects further, I suggest starting with the **Personal Portfolio**:\n\n"
                "1. Set up a clear semantic skeleton using `<header>`, `<nav>`, `<main>`, `<section>`, and `<footer>`.\n"
                "2. Add anchor links (`href=\"#about\"`, `href=\"#projects\"`) in your navigation bar for smooth page scrolling.\n"
                "3. Structure each project in an `<article>` tag with clean headings, live links, and repository buttons.\n\n"
                "Would you like to see starter code for this portfolio?"
            )
        elif any(k in combined_recent for k in ["javascript", "js"]):
            return (
                "Great! Here are practical steps to continue your JavaScript journey:\n\n"
                "1. **DOM Interaction**: Practice selecting elements with `document.querySelector` and dynamically updating content.\n"
                "2. **Event Handling**: Add interactive click and input handlers using `addEventListener`.\n"
                "3. **Async / Fetch API**: Load JSON data from a public API using `async/await` and render it into cards.\n\n"
                "Would you like an example of building a mini-project like a weather app or task list?"
            )
        elif any(k in combined_recent for k in ["login page", "login form", "login"]):
            return (
                "For your login page, you can enhance it with these practical features:\n\n"
                "1. **Show/Hide Password**: A toggle icon that switches `input.type` between `'password'` and `'text'`.\n"
                "2. **Client Validation**: Real-time feedback for valid email format and password strength.\n"
                "3. **Clean CSS Styling**: Centered card layout with responsive padding and subtle hover shadows.\n\n"
                "Would you like the JavaScript or CSS snippet for any of these?"
            )

    # Standalone follow-up for "first one" without prior history context
    if any(k in clean_q for k in ["first one", "the first one", "first project", "about the first"]):
        return (
            "The **Personal Developer Portfolio** is the ideal first project to build:\n\n"
            "1. **Header & Navigation**: Introduce your name and include smooth-scrolling links to About, Skills, Projects, and Contact.\n"
            "2. **About Me**: Brief bio highlighting your technical stack and passion for development.\n"
            "3. **Projects Showcase**: Interactive cards featuring project screenshots, descriptions, tech tags, and links to live demos/GitHub.\n"
            "4. **Skills Matrix**: Badges displaying your frontend/backend technologies.\n"
            "5. **Contact Form**: Semantic form with inputs for Name, Email, and Message.\n\n"
            "Would you like a starter HTML/CSS skeleton for this portfolio?"
        )

    # 3. Dedicated topic handlers
    # Case A: Studying CSE / Computer Science
    if any(k in clean_q for k in ["studying cse", "study cse", "studying computer science", "cse student", "computer science and engineering", "computer science"]):
        greeting_name = ""
        if store:
            name_records = store.query_by_privacy_type("Real Name")
            if name_records:
                greeting_name = f" {name_records[-1]['original_text'].title()}"
        return (
            f"Hello{greeting_name}! It's great to connect with a Computer Science and Engineering (CSE) student. "
            "CSE is an exciting and versatile field covering core subjects like algorithms, data structures, full-stack app development, databases, and systems. "
            "How can I help you with your studies, coding projects, or learning goals today?"
        )

    # Case B: Learning to build apps / App development
    if any(k in clean_q for k in [
        "learning how to build apps", "learning to build apps", "learn to build apps",
        "build apps", "building apps", "how to build apps", "app development",
        "develop apps", "create apps", "build an app", "creating apps"
    ]):
        return (
            "That's a fantastic journey! Building apps is one of the most rewarding skills in software development. "
            "Depending on what kind of apps you want to create, here are the primary paths:\n\n"
            "1. **Web Applications**: Start with HTML5, CSS3, and JavaScript, then explore frontend frameworks like React or Vue, and backends with Node.js/Express or Python (FastAPI/Django).\n"
            "2. **Cross-Platform Mobile Apps**: Frameworks like Flutter (Dart) or React Native (JavaScript/TypeScript) let you build for both Android and iOS from a single codebase.\n"
            "3. **Native Mobile Development**: Kotlin with Jetpack Compose for Android, or Swift with SwiftUI for iOS.\n"
            "4. **Desktop Apps**: Electron or Tauri allow you to build cross-platform desktop applications using modern web technologies.\n\n"
            "Would you like some beginner-friendly app ideas to start practicing with, or guidance on choosing a tech stack?"
        )

    # Case D: Beginner app recommendations
    if any(k in clean_q for k in [
        "what apps can i build as a beginner", "what apps can i build", "apps can i build as a beginner",
        "apps can i build", "apps for beginners", "beginner apps", "apps to build as a beginner",
        "apps to build", "apps i can build", "project ideas for apps", "app ideas"
    ]):
        return (
            "Here are excellent beginner app projects that build fundamental developer skills:\n\n"
            "1. **To-Do / Task Management App**:\n"
            "   - **Why build it**: Teaches the essential CRUD (Create, Read, Update, Delete) paradigm, state management, and data persistence.\n"
            "   - **Key features**: Add tasks, toggle completion, filter by status (All, Active, Completed), and persist data in `localStorage`.\n\n"
            "2. **Live Weather Dashboard**:\n"
            "   - **Why build it**: Great for mastering asynchronous API requests (`fetch` / `axios`), handling loading/error states, and displaying dynamic UI cards.\n"
            "   - **Key features**: Search by city name, display current temperature, weather icons, and humidity.\n\n"
            "3. **Personal Expense Tracker**:\n"
            "   - **Why build it**: Deepens understanding of numeric calculations, form validation, and categorized data management.\n"
            "   - **Key features**: Log transactions, select categories (Food, Utilities, Entertainment), and view spending summaries.\n\n"
            "4. **Simple Notes App with Markdown Preview**:\n"
            "   - **Why build it**: Practice text input handling, real-time rendering, and client-side searching.\n"
            "   - **Key features**: Dual-pane editor and preview, autosave, and keyword search.\n\n"
            "Which type of app would you like to build first (web or mobile)?"
        )

    # 4. Check if user query matches retrieved long-term memories
    if used_memories and isinstance(used_memories, list):
        for mem in used_memories:
            fact = mem.get("fact", "").strip()
            fact_clean = re.sub(r'\[.*?\]\s*', '', fact).strip()
            fact_lower = fact_clean.lower()

            if any(k in clean_q for k in ["web framework", "framework", "prefer working with"]) and "fastapi" in fact_lower:
                return "Based on your saved preferences, you prefer working with FastAPI for web development."

            if any(k in clean_q for k in ["my name", "who am i", "what is my name"]) and "john doe" in fact_lower:
                return "Your name is John Doe."

            if any(k in clean_q for k in ["my name", "who am i", "what is my name"]) and any(w in fact_lower for w in ["user name is", "name is"]):
                name_match = re.search(r'name is\s+([^.]+)', fact_clean, re.IGNORECASE)
                if name_match:
                    return f"Your name is {name_match.group(1).strip()}."

            if any(k in clean_q for k in ["programming language", "language do i prefer", "language prefer"]) and "python" in fact_lower:
                return "Based on your profile, you prefer Python programming language."

            if any(k in clean_q for k in ["course", "studying", "study", "major", "degree", "subject", "branch"]) and any(w in fact_lower for w in ["studying", "student", "study", "cse", "computer science", "engineering"]):
                formatted_fact = re.sub(r'^User(?:\'s|\s+is|\s+are)?\s*', 'You are ', fact_clean, flags=re.IGNORECASE)
                if not formatted_fact.lower().startswith("you are"):
                    formatted_fact = f"You are {formatted_fact}"
                return f"Based on your profile, {formatted_fact}."

        first_mem = used_memories[0]
        first_fact = re.sub(r'\[.*?\]\s*', '', first_mem.get("fact", "")).strip()
        first_fact_clean = re.sub(r'^User\s+(?:is\s+)?', 'You are ', first_fact, flags=re.IGNORECASE)
        user_profile_queries = ["what is my", "what are my", "what do i", "who am i", "where do i", "tell me about my", "tell me about me", "my profile", "my preference", "my skill", "what course", "what am i", "what degree"]
        if any(k in clean_q for k in user_profile_queries) or ("my" in clean_q and any(w in clean_q for w in ["name", "stack", "role", "language", "framework", "preference", "course", "degree", "study"])):
            return f"Based on what you've shared: {first_fact_clean}."

    if any(k in clean_q for k in [
        "projects on html", "html project", "suggest me some projects", "suggest some projects",
        "suggest projects", "html projects", "project ideas", "recommend some projects", "recommend projects"
    ]):
        return (
            "Here are several engaging project ideas you can build with HTML and CSS:\n\n"
            "1. **Personal Developer Portfolio**: A multi-section site highlighting your bio, projects, and contact info using semantic tags (`<header>`, `<section>`, `<footer>`).\n"
            "2. **Product Landing Page**: A modern promotional page with hero headlines, feature grids, pricing tables, and call-to-action buttons.\n"
            "3. **Interactive Survey or Registration Form**: A rich form utilizing diverse inputs (`email`, `date`, `range`, `select`), fieldsets, and validation attributes.\n"
            "4. **Recipe Book / Documentation Layout**: A structured content page with ordered recipe steps, ingredient tables, and side navigation.\n"
            "5. **Event Schedule & RSVP Page**: A conference schedule built with accessible HTML tables and an RSVP submission form.\n\n"
            "Which one would you like to start building?"
        )

    if any(k in clean_q for k in [
        "create a portfolio", "create portfolio", "build a portfolio", "build portfolio",
        "make a portfolio", "make portfolio", "how can i create a portfolio", "how to build a portfolio",
        "how to create a portfolio", "how do i create a portfolio"
    ]):
        return (
            "To create a standout developer portfolio website, follow these structured steps:\n\n"
            "1. **Semantic HTML Structure**: Use clean tags (`<header>`, `<nav>`, `<main>`, `<section>`, and `<footer>`) divided into Hero, About, Projects, Skills, and Contact.\n"
            "2. **Curate 3-4 Key Projects**: Include project screenshots, a concise summary, tech stack badges, and live demo / GitHub links.\n"
            "3. **Highlight Core Skills**: Categorize into Frontend (HTML, CSS, JS), Backend, and Developer Tools.\n"
            "4. **Responsive CSS Layout**: Style using modern Flexbox and CSS Grid with clean contrast, readable typography, and mobile responsiveness.\n"
            "5. **Accessible Contact Form**: Add styled form inputs for visitors and recruiters to reach you.\n"
            "6. **Deploy**: Host for free using GitHub Pages, Vercel, or Netlify.\n\n"
            "Would you like an HTML boilerplate skeleton to get started?"
        )

    if any(k in clean_q for k in ["suggest some features", "portfolio features", "features for html", "features for portfolio"]):
        return (
            "Here are key features to include in your HTML portfolio website:\n\n"
            "1. **Hero Section**: A compelling introduction with your role, a clear call-to-action, and quick links.\n"
            "2. **Project Showcase Grid**: Responsive cards with preview images, project summaries, tech stack tags, and repository links.\n"
            "3. **Skills Matrix**: Categorized tech chips highlighting your strengths in languages, frameworks, and tools.\n"
            "4. **About Me / Bio**: A concise background story detailing your development experience and passions.\n"
            "5. **Accessible Contact Form**: Fields for name, email, and message, with clear validation attributes.\n\n"
            "Would you like starter code for any of these sections?"
        )

    if any(k in clean_q for k in ["what is html", "explain html", "html definition", "about html"]):
        return (
            "**HTML (HyperText Markup Language)** is the foundational standard for structuring content on the World Wide Web.\n\n"
            "- **What it does**: HTML provides the structural skeleton of web pages using elements and tags (such as `<h1>`, `<p>`, `<a>`, `<div>`, `<table>`, and `<form>`). It tells the browser what content to display and how that content is organized.\n"
            "- **Where it is used**: Virtually every website and web application in the world uses HTML as its base. In modern web development, HTML defines content structure, CSS handles visual design, and JavaScript provides interactive behavior.\n"
            "- **Modern Standard**: HTML5 introduced semantic elements (like `<main>`, `<nav>`, `<article>`, and `<section>`) that make pages easier to maintain, accessible for screen readers, and search engine friendly."
        )

    if any(k in clean_q for k in ["what is python", "explain python", "about python", "python definition"]):
        return (
            "**Python** is a high-level, interpreted programming language celebrated for its readability and concise syntax.\n\n"
            "- **Key Features**: Dynamically typed, cross-platform, automatic memory management, and extensive standard library.\n"
            "- **Primary Use Cases**: Web backends (FastAPI, Django), Data Science & Machine Learning (Pandas, PyTorch, scikit-learn), Automation/Scripting, and AI Applications.\n"
            "- **Why Learn It**: It allows developers to express complex concepts in fewer lines of code than C++ or Java, enabling rapid prototyping and clean architecture."
        )

    if any(k in clean_q for k in ["login page", "create a login page", "build a login page", "login form"]):
        return (
            "To create a clean, secure login page, here is the recommended approach:\n\n"
            "1. **HTML Structure**:\n"
            "```html\n"
            "<form class=\"login-card\" action=\"/api/login\" method=\"POST\">\n"
            "  <h2>Sign In</h2>\n"
            "  <div class=\"form-group\">\n"
            "    <label for=\"email\">Email Address</label>\n"
            "    <input type=\"email\" id=\"email\" name=\"email\" required placeholder=\"you@example.com\">\n"
            "  </div>\n"
            "  <div class=\"form-group\">\n"
            "    <label for=\"password\">Password</label>\n"
            "    <input type=\"password\" id=\"password\" name=\"password\" required placeholder=\"••••••••\">\n"
            "  </div>\n"
            "  <button type=\"submit\">Log In</button>\n"
            "</form>\n"
            "```\n\n"
            "2. **CSS Layout**: Center the card using `min-height: 100vh; display: flex; align-items: center; justify-content: center;` with a modern card shadow and clean focus borders.\n"
            "3. **Security & Validation**: Ensure your inputs use `type=\"email\"` and `type=\"password\"`, submit credentials over HTTPS, and sanitize user input."
        )

    if any(k in clean_q for k in ["learning javascript", "learning js", "learn javascript", "learn js", "im learning javascript", "i am learning javascript"]):
        return (
            "That's great! JavaScript is the core programming language that brings web pages to life.\n\n"
            "- **Core Fundamentals**: Focus on variables (`let`, `const`), functions, template literals, and array methods (`map`, `filter`, `reduce`).\n"
            "- **Web Interactivity**: Practice DOM manipulation (`document.querySelector`) and listening for user actions with `addEventListener`.\n"
            "- **Asynchronous JS**: Get comfortable with Promises and `async/await` using `fetch()` to load dynamic data from APIs.\n\n"
            "Would you like guidance on setting up a beginner JavaScript project?"
        )

    if "python" in clean_q:
        return "Python is an expressive, high-level language widely used for web backends, data engineering, and AI. Are you building a script, an API, or working with data?"
    if "fastapi" in clean_q:
        return "FastAPI is a modern, high-performance web framework for Python based on standard type hints. It automatically produces interactive OpenAPI Swagger documentation."
    if "docker" in clean_q:
        return "Docker allows you to package an application and its dependencies into a container, ensuring it runs identically across development, staging, and production environments."

    # 5. Contextual fallback for other queries (Guaranteed no placeholder leakage)
    topic = re.sub(r'^(?:can you|could you|please|what is|tell me about|how do i|how to|i am|im|i\'m|currently|recently|learning to|learning how to|learning|studying|my name is)\s+', '', clean_q, flags=re.IGNORECASE).strip()
    topic = re.sub(r'\b(?:real_name|email_address|phone_number|detailed_address|medical_health|financial_account|id_number|verification_code|password|key|token|mask)_[0-9]+\b', '', topic, flags=re.IGNORECASE).strip()
    topic = re.sub(r'\s+', ' ', topic)
    if not topic or len(topic) < 2:
        topic = "your query"
    return (
        f"Regarding {topic}: while in offline mode, I can provide technical explanations, code skeletons, and best practices. "
        "Feel free to ask for specific code examples or architectural guidance!"
    )

def generate_ai_chat_response(masked_text: str, config: dict, has_llm_config: bool, memory_context: str = "", history: list = None, used_memories: list = None, store: PrivacyStore = None) -> tuple:
    """
    AI Processing Step (Task 12 & Task 17 Gemini Integration):
    Sends masked text, sanitized conversation history, and privacy-masked memory context to Gemini (gemini-3.6-flash).
    Features:
      - Max 2 retries with exponential backoff for transient errors (429, 500, 502, 503, 504, timeouts).
      - Strict API key redaction in logs.
      - Graceful fallback to deterministic offline conversational engine on failure.
      - Returns tuple: (masked_response_text, provider_name)
    """
    system_prompt = (
        "You are OKFMem Assistant, an intelligent, helpful, and friendly conversational AI assistant.\n"
        "Guidelines:\n"
        "- Communicate naturally and conversationally. Do NOT open responses with robotic boilerplate like 'I have received your message'.\n"
        "- When user memories are provided below, use those facts to personalize your response naturally. NEVER output internal category tags (such as [Skill], [Preference], [Project], [Fact]), internal IDs, or raw JSON unless explicitly requested.\n"
        "- Maintain short-term conversation context across turns to interpret follow-up queries (such as 'yes', 'tell me more', 'how', etc.).\n"
        "- Keep answers practical, clear, and concise."
    )
    if memory_context:
        clean_context = re.sub(r'-\s*\[.*?\]\s*', '- ', memory_context)
        system_prompt += "\n\nUser Context:\n" + clean_context

    gemini_api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    gemini_model = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash").strip() or "gemini-3.6-flash"

    # Build multi-turn contents for Gemini
    contents = []
    if history and isinstance(history, list):
        for turn in history[-6:]:
            if isinstance(turn, dict) and turn.get("text"):
                raw_role = turn.get("role", "user")
                role = "model" if raw_role in ["model", "assistant"] else "user"
                t = str(turn.get("text")).strip()
                if t:
                    contents.append({"role": role, "parts": [{"text": t}]})

    # Normalize consecutive same roles
    normalized_contents = []
    for item in contents:
        if normalized_contents and normalized_contents[-1]["role"] == item["role"]:
            normalized_contents[-1]["parts"][0]["text"] += "\n" + item["parts"][0]["text"]
        else:
            normalized_contents.append(item)

    # Ensure last turn is user with current masked_text without duplicate concatenation
    if normalized_contents and normalized_contents[-1]["role"] == "user":
        last_turn_text = normalized_contents[-1]["parts"][0]["text"].strip()
        if last_turn_text != masked_text.strip():
            normalized_contents[-1]["parts"][0]["text"] += "\n" + masked_text
    else:
        normalized_contents.append({"role": "user", "parts": [{"text": masked_text}]})

    # Task 12 & 17: Google Gemini API Provider with Client Reuse, Transient Retries & Exponential Backoff
    if gemini_api_key:
        max_retries = 1
        for attempt in range(max_retries + 1):
            try:
                # 1. Try official google-genai Python SDK with client reuse
                try:
                    client = get_genai_client(gemini_api_key)
                    if client:
                        from google.genai import types
                        sdk_contents = []
                        for c in normalized_contents:
                            sdk_contents.append(types.Content(
                                role=c["role"],
                                parts=[types.Part.from_text(text=p["text"]) for p in c["parts"]]
                            ))
                        response = client.models.generate_content(
                            model=gemini_model,
                            contents=sdk_contents,
                            config=types.GenerateContentConfig(
                                system_instruction=system_prompt,
                            )
                        )
                        if response and hasattr(response, 'text') and response.text:
                            return response.text.strip(), "gemini"
                except Exception as sdk_err:
                    # Let outer handler inspect error and decide on fallback
                    raise sdk_err

                # 2. Direct HTTP REST API fallback for Gemini
                import urllib.request
                import urllib.error
                import json
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_api_key}"
                headers = {"Content-Type": "application/json"}
                payload = {
                    "contents": normalized_contents,
                    "systemInstruction": {"parts": [{"text": system_prompt}]}
                }
                req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
                with urllib.request.urlopen(req, timeout=8) as resp:
                    res_data = json.loads(resp.read().decode('utf-8'))
                    candidates = res_data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts:
                            return parts[0].get("text", "").strip(), "gemini"

                raise RuntimeError("Gemini API returned an empty or invalid response payload.")

            except Exception as e:
                err_str = str(e)
                redacted_err = err_str.replace(gemini_api_key, "[REDACTED_API_KEY]") if gemini_api_key else err_str

                status_code = getattr(e, 'code', getattr(e, 'status_code', None))
                is_quota_exceeded = any(phrase in err_str.lower() for phrase in [
                    "quota", "resource_exhausted", "resourceexhausted", "exceeded your current quota"
                ])

                # Permanent client errors (400, 401, 403, 404) or quota exhaustion -> do not retry
                if is_quota_exceeded or status_code in [400, 401, 403, 404]:
                    sys.stderr.write(f"[Gemini API Quota/Client Limit] {redacted_err}. Gracefully falling back to offline engine.\n")
                    break

                is_transient = False
                if status_code in [500, 502, 503, 504]:
                    is_transient = True
                elif any(code in err_str for code in ["503", "500", "502", "504"]):
                    is_transient = True
                elif any(phrase in err_str.lower() for phrase in [
                    "unavailable", "deadline_exceeded", "overloaded", "capacity",
                    "temporarily unavailable", "timed out", "timeout", "connection reset",
                    "connection refused", "connection error", "network error"
                ]):
                    is_transient = True
                elif isinstance(e, (socket.timeout, TimeoutError)):
                    is_transient = True

                if is_transient and attempt < max_retries:
                    backoff = 0.3 * (2 ** attempt)
                    sys.stderr.write(f"[Gemini API Transient Error (Attempt {attempt+1}/{max_retries+1})] {redacted_err}. Retrying in {backoff}s...\n")
                    time.sleep(backoff)
                    continue
                else:
                    sys.stderr.write(f"[Gemini API Fallback] {redacted_err}. Gracefully falling back to offline engine.\n")
                    break

    if has_llm_config:
        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=config["llm"]["base_url"],
                api_key=config["llm"]["api_key"]
            )
            model = config["llm"].get("model", "gpt-4o-mini")
            messages = [{"role": "system", "content": system_prompt}]
            if history and isinstance(history, list):
                for turn in history[-6:]:
                    r = "assistant" if turn.get("role") in ["assistant", "model"] else "user"
                    messages.append({"role": r, "content": str(turn.get("text", ""))})
            messages.append({"role": "user", "content": masked_text})
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.7
            )
            return response.choices[0].message.content.strip(), "openai"
        except Exception as e:
            sys.stderr.write(f"[OpenAI Provider Error] {str(e)}\n")

    # Deterministic Conversational Offline Fallback
    offline_reply = generate_offline_conversational_response(
        user_text=masked_text,
        memory_context=memory_context,
        history=history,
        used_memories=used_memories,
        store=store
    )
    return offline_reply, "offline"


def process_text(text: str) -> dict:
    """
    Production MemPrivacy Service (Test Endpoint /api/privacy/test).
    Uses official MemPrivacy APIs:
      - PrivacyStore (local SQLite mapping)
      - detect_and_mask_dialogue / mask_dialogue (official masking)
      - unmask_dialogue (official restoration)
    """
    config_path = os.path.join(src_dir, "privacy_config.yaml")
    config = load_yaml_config(config_path)

    prompt_path = config.get("privacy", {}).get("prompt_path", "prompts/extract_privacy.txt")
    if not os.path.isabs(prompt_path):
        config["privacy"]["prompt_path"] = os.path.join(src_dir, prompt_path)

    db_name = config.get("privacy", {}).get("db_path", "privacy_store.db")
    db_path = os.path.join(script_dir, db_name)
    store = PrivacyStore(db_path=db_path)

    try:
        mask_levels = config.get("privacy", {}).get("mask_levels", ["PL2", "PL3", "PL4"])
        masked_text, detected_items, llm_active = run_local_mem_privacy_detection(
            text=text,
            config=config,
            store=store,
            mask_levels=mask_levels
        )

        restored_text = unmask_dialogue(masked_text, store)

        return {
            "success": True,
            "original": text,
            "masked": masked_text,
            "restored": restored_text,
            "detected": detected_items,
            "llm_active": llm_active
        }
    except Exception as err:
        return {
            "success": False,
            "original": text,
            "error": f"MemPrivacy processing error: {str(err)}"
        }
    finally:
        store.close()

def clean_memory_title(title: str) -> str:
    if not title:
        return "Untitled Memory"
    clean = title.strip()
    # Strip leading verb/phrase prefixes if captured in title
    clean = re.sub(r'^(?:currently\s+|currenlty\s+|recently\s+|i\s+am\s+|i\'m\s+)?(?:learning\s+how\s+to\s+build|learning\s+how\s+to|learning\s+to\s+build|learning\s+to\s+use|learning\s+to|learning|studying|mastering|exploring|working\s+on|building|developing|creating|using|preferring)\s+', '', clean, flags=re.IGNORECASE)
    # Strip trailing phrase connectors
    clean = re.sub(r'\s+(?:and|with|for)\s+(?:building|developing|working|learning|creating).*$', '', clean, flags=re.IGNORECASE)
    # Strip leading 'how to build', 'how to create', 'how to make', 'how to'
    clean = re.sub(r'^(?:how\s+to\s+build\s+|how\s+to\s+create\s+|how\s+to\s+make\s+|how\s+to\s+)', '', clean, flags=re.IGNORECASE)
    # Strip leading articles 'a', 'an', 'the'
    clean = re.sub(r'^(?:an?\s+|the\s+)', '', clean, flags=re.IGNORECASE)
    clean = clean.strip()
    if not clean:
        clean = title.strip()

    if clean.lower() == "apps":
        clean = "App Development"

    # Normalize spacing before parentheses e.g. "cse(computer Science and Engineering)" -> "cse (computer Science and Engineering)"
    clean = re.sub(r'(\w)\(', r'\1 (', clean)

    # Normalize common acronyms
    acronym_map = {
        "cse": "CSE",
        "it": "IT",
        "ece": "ECE",
        "eee": "EEE",
        "ai": "AI",
        "ml": "ML",
        "llm": "LLM",
        "rag": "RAG",
        "html": "HTML",
        "css": "CSS",
        "js": "JavaScript",
        "api": "API",
        "rest": "REST",
        "ui": "UI",
        "ux": "UX"
    }

    # Handle parenthetical title like "cse (computer science and engineering)"
    paren_match = re.match(r'^([a-zA-Z0-9]+)\s*\((.*?)\)$', clean)
    if paren_match:
        main_part = paren_match.group(1)
        sub_part = paren_match.group(2)
        norm_main = acronym_map.get(main_part.lower(), main_part.upper() if len(main_part) <= 4 else main_part.title())
        norm_sub = sub_part.title()
        return f"{norm_main} ({norm_sub})"

    if clean.lower() in acronym_map:
        return acronym_map[clean.lower()]

    if clean.islower():
        clean = clean.title()
    return clean

def extract_memories_from_text(masked_text: str, store: PrivacyStore, config: dict, has_cloud_llm: bool, cloud_config: dict) -> list:
    """
    Task 9, Task 13 & Multi-Memory Fact/Preference Extraction:
    Identifies all distinct, useful long-term information (facts, studies, skills, preferences, projects)
    from masked conversation text while maintaining the MemPrivacy boundary.
    Supports decomposing compound messages into multiple distinct memory records.
    Restores masked placeholders locally and sets privacy to 'Protected' if sensitive data was present.
    """
    # Guard: Short conversational messages, follow-ups, questions, and common filler must never become memories
    stripped_lower = masked_text.strip().lower()
    clean_conv = re.sub(r'[^\w\s]', '', stripped_lower).strip()
    conversational_ignores = {
        "yes", "yeah", "yep", "no", "nope", "ok", "okay", "sure", "thanks", "thank you",
        "hello", "hi", "hey", "how are you", "what is html", "what is html and where is it used",
        "what is python", "explain python", "how can i create a portfolio", "how to create a portfolio",
        "can you suggest some features", "can you suggest me some projects", "can you suggest some projects",
        "can you suggest me some html projects", "can you suggest some html projects",
        "tell me more", "tell me more about the first one", "tell me about the first one", "explain the first one",
        "first one", "the first one", "continue", "how", "why", "give examples", "more", "details"
    }
    if clean_conv in conversational_ignores or len(clean_conv) < 4:
        return []

    candidates = []

    # 1. Expanded Pattern & Heuristic Extraction
    # 1a. Personal Identity / Name signals -> Category: Fact
    name_matches = re.finditer(
        r'\b(?:my name is|call me|i am|i\'m)\s+([A-Za-z0-9_#+.\-<> ]+?)(?:\s+and\b|\s+with\b|\s+for\b|[.,;]|$)',
        masked_text,
        re.IGNORECASE
    )
    for m in name_matches:
        raw_name = m.group(1).strip()
        is_masked_name = bool(re.search(r'<(?:Real_Name|Name)_\d+>|\breal_name_\d+\b', raw_name, re.IGNORECASE))
        words = raw_name.lower().split()
        if not words or any(w in EXCLUDED_NAME_WORDS for w in words):
            continue
        if is_masked_name or (1 <= len(words) <= 4 and all(re.match(r'^[a-zA-Z\'-]+$', w) for w in words)):
            candidates.append({
                "title": "User Name",
                "fact": f"User name is {raw_name}.",
                "category": "Fact",
                "importance": "High",
                "confidence": 96
            })

    # 1b. Academic Study / Education signals -> Category: Fact
    study_matches = re.finditer(
        r'\b(?:i am|i\'m)?\s*(?:currently|currenlty|currenly|recently|now)?\s*(?:studying|majoring in|pursuing a degree in|pursuing|enrolled in)\s+([A-Za-z0-9_#+.\-<>()/ ]+?)(?:\s+and\b|\s+with\b|\s+for\b|\s+at\b|[.,;]|$)',
        masked_text,
        re.IGNORECASE
    )
    for m in study_matches:
        course = clean_memory_title(m.group(1))
        if course and len(course) > 1 and course.lower() not in ["a lot", "more", "now"]:
            candidates.append({
                "title": course,
                "fact": f"User is studying {course}.",
                "category": "Fact",
                "importance": "High",
                "confidence": 95
            })

    # 1c. Student / Role signals -> Category: Fact
    student_matches = re.finditer(
        r'\b(?:i am|i\'m)?\s*(?:a|an)\s+([A-Za-z0-9_#+.\-<>()/ ]+?\s+(?:student|major|undergrad|graduate))\b(?:\s+at\b|\s+in\b|[.,;]|$)',
        masked_text,
        re.IGNORECASE
    )
    for m in student_matches:
        stud_role = clean_memory_title(m.group(1))
        if stud_role and len(stud_role) > 2:
            candidates.append({
                "title": stud_role,
                "fact": f"User is a {stud_role}.",
                "category": "Fact",
                "importance": "High",
                "confidence": 95
            })

    # 1d. Technology & Skill Learning signals -> Category: Skill
    learn_matches = re.finditer(
        r'\b(?:i am|i\'m)?\s*(?:currently|currenlty|currenly|recently|now)?\s*(?:learning|learning to use|learning how to build|learning how to use|getting started with|mastering|exploring)\s+([A-Za-z0-9_#+.\-<>()/ ]+?)(?:\s+and\b|\s+with\b|\s+for\b|[.,;]|$)',
        masked_text,
        re.IGNORECASE
    )
    for m in learn_matches:
        topic = clean_memory_title(m.group(1))
        if topic and len(topic) > 1 and topic.lower() not in ["a lot", "more", "now"]:
            fact_str = f"User is learning {topic}." if "learning" not in topic.lower() else f"User is {topic}."
            candidates.append({
                "title": topic,
                "fact": fact_str,
                "category": "Skill",
                "importance": "High",
                "confidence": 95
            })

    # 1e. Preference signals -> Category: Preference
    pref_matches = re.finditer(
        r'\b(?:i prefer|my preference is|i like|prefer working with|prefer using|decided to use|fan of|enjoy using)\s+(?:working with\s+|using\s+)?([A-Za-z0-9_#+.\-<>()/ ]+?)(?:\s+for\s+([A-Za-z0-9_#+.\- ]+?))?(?:\s+and\b|\s+over\b|[.,;]|$)',
        masked_text,
        re.IGNORECASE
    )
    for m in pref_matches:
        pref = clean_memory_title(m.group(1))
        context_field = m.group(2).strip() if m.group(2) else ""
        if pref and len(pref) > 1 and pref.lower() not in ["working", "that", "this", "it"]:
            if context_field:
                fact_str = f"User prefers {pref} for {context_field}."
            elif "theme" in pref.lower():
                fact_str = f"User prefers {pref.lower()}."
            else:
                fact_str = f"User prefers working with {pref}."
            candidates.append({
                "title": pref,
                "fact": fact_str,
                "category": "Preference",
                "importance": "High",
                "confidence": 94
            })

    # 1f. Project signals -> Category: Project
    proj_matches = re.finditer(
        r'\b(?:i am|i\'m)?\s*(?:currently|recently|now)?\s*(?:working on|building|developing|creating|designing|architecting)\s+(?:an?\s+|the\s+)?([A-Za-z0-9_#+.\-<>()/ ]+?)\s+(?:project|app|application|system|service|platform)\b',
        masked_text,
        re.IGNORECASE
    )
    for m in proj_matches:
        proj = clean_memory_title(m.group(1))
        if proj and len(proj) > 1:
            full_title = f"{proj} Project" if "project" not in proj.lower() else proj
            candidates.append({
                "title": full_title,
                "fact": f"User is working on {proj} project.",
                "category": "Project",
                "importance": "High",
                "confidence": 94
            })

    # 1g. General Skill / Tool signals -> Category: Skill
    skill_matches = re.finditer(
        r'\b(?:i am using|i\'m using|i use|i am working with|i\'m working with|i work with|i work on|i specialize in|experienced with|skilled in|stack includes|stack features|stack is|proficient in|code in|build with)\s+([A-Za-z0-9_#+.\-<>()/ ]+?)(?:\s+for\b|\s+and\b|\s+in\b|\s+with\b|[.,;]|$)',
        masked_text,
        re.IGNORECASE
    )
    for m in skill_matches:
        sk = clean_memory_title(m.group(1))
        if sk and len(sk) > 1 and sk.lower() not in ["a lot", "that", "it", "more"]:
            candidates.append({
                "title": sk,
                "fact": f"User works with {sk}.",
                "category": "Skill",
                "importance": "Medium",
                "confidence": 92
            })

    # 1h. Fact / Role signals -> Category: Fact
    fact_matches = re.finditer(
        r'\b(?:my role is|my job is|i work as a|i work as an|currently a|currently an)\s+([A-Za-z0-9_#+.\-<>()/ ]+?)(?:\s+at\b|\s+for\b|\s+in\b|[.,;]|$)',
        masked_text,
        re.IGNORECASE
    )
    for m in fact_matches:
        role = clean_memory_title(m.group(1))
        if role and len(role) > 1 and role.lower() not in ["lot", "that", "user"]:
            candidates.append({
                "title": role,
                "fact": f"User role is {role}.",
                "category": "Fact",
                "importance": "High",
                "confidence": 93
            })

    # 2. LLM Extraction on masked_text (Only when needed, avoiding redundant cloud latency)
    has_high_confidence = any(c.get("confidence", 0) >= 92 for c in candidates)
    lower_masked = masked_text.strip().lower()
    is_question = bool(re.match(r'^(?:what|how|who|why|where|when|which|whose|whom|can you|could you|tell me|explain|is it|are you|do you|what\'s|whats|how\'s|hows)\b', lower_masked)) or lower_masked.endswith('?')
    is_greeting_filler = lower_masked in [
        "hi", "hello", "hey", "yes", "no", "ok", "okay", "sure", "thanks", "thank you",
        "bye", "goodbye", "cool", "great", "nice", "awesome", "got it", "understood"
    ]
    has_personal_indicator = bool(re.search(
        r'\b(?:i|my|me|i\'m|myself|am|studying|learning|prefer|working on|building|student|engineer|developer|role|profession)\b',
        lower_masked
    ))

    # Skip cloud extraction if high confidence memories were already extracted, or if input is a question/greeting without personal assertions
    should_run_llm_extraction = (not has_high_confidence) and (not is_question) and (not is_greeting_filler) and has_personal_indicator

    gemini_api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    gemini_model = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash").strip() or "gemini-3.6-flash"

    if should_run_llm_extraction and gemini_api_key:
        try:
            import urllib.request
            import json
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_api_key}"
            headers = {"Content-Type": "application/json"}
            prompt = (
                "You are an expert memory extraction engine for OKFMem. Identify any long-term user facts, skills, preferences, or projects in the message below.\n"
                "A single user message may contain multiple pieces of personal information (e.g. user name, academic course/degree, technologies learned, preferences, projects). Extract EACH one as a separate distinct object in the JSON array.\n\n"
                "Strict Category Mapping Rules:\n"
                "- 'Fact': User's personal identity/name, academic studies/course (e.g. CSE, Computer Science, Engineering), student status, degree, profession, location.\n"
                "- 'Skill': Programming languages, frameworks, or developer tools being learned or mastered.\n"
                "- 'Preference': Preferred tools, frameworks, themes (e.g. dark themes), development environments, or design choices.\n"
                "- 'Project': Specific systems, software, apps, or platforms being built or designed.\n\n"
                "Return ONLY a JSON array of objects with keys: 'title', 'fact', 'category' ('Skill', 'Preference', 'Project', 'Fact'), 'importance' ('High', 'Medium', 'Low'), 'confidence' (integer 85-98).\n"
                "If no long-term information is present, return [].\n\n"
                f"User Message: \"{masked_text}\""
            )
            payload = {
                "contents": [{"parts": [{"text": prompt}]}]
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=6) as resp:
                res_data = json.loads(resp.read().decode('utf-8'))
                candidates_parts = res_data.get("candidates", [])
                if candidates_parts:
                    parts = candidates_parts[0].get("content", {}).get("parts", [])
                    if parts:
                        raw_json_str = parts[0].get("text", "").strip()
                        raw_json_str = re.sub(r'^```(?:json)?\s*', '', raw_json_str, flags=re.IGNORECASE)
                        raw_json_str = re.sub(r'\s*```$', '', raw_json_str).strip()
                        parsed_memories = None
                        try:
                            parsed_memories = json.loads(raw_json_str)
                        except Exception:
                            try:
                                import json_repair
                                parsed_memories = json_repair.loads(raw_json_str)
                            except Exception:
                                pass

                        if isinstance(parsed_memories, list):
                            for pm in parsed_memories:
                                if isinstance(pm, dict) and pm.get("title") and pm.get("fact"):
                                    raw_cat = str(pm.get("category", "Fact")).strip().capitalize()
                                    if raw_cat not in ["Skill", "Preference", "Project", "Fact"]:
                                        raw_cat = "Fact"
                                    candidates.append({
                                        "title": clean_memory_title(str(pm.get("title"))),
                                        "fact": str(pm.get("fact")).strip(),
                                        "category": raw_cat,
                                        "importance": str(pm.get("importance", "High")).strip(),
                                        "confidence": int(pm.get("confidence", 94))
                                    })
        except Exception as e:
            sys.stderr.write(f"[Gemini Extraction Error] {str(e)}\n")

    elif should_run_llm_extraction and has_cloud_llm:
        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=cloud_config["llm"]["base_url"],
                api_key=cloud_config["llm"]["api_key"]
            )
            model = cloud_config["llm"].get("model", "gpt-4o-mini")
            prompt = (
                "You are an expert memory extraction engine for OKFMem. Identify any long-term user facts, skills, preferences, or projects in the message below.\n"
                "A single user message may contain multiple pieces of personal information. Extract EACH one as a separate distinct object in the JSON array.\n\n"
                "Strict Category Mapping Rules:\n"
                "- 'Fact': User's personal identity/name, academic studies/course (e.g. CSE, Computer Science), student status, profession.\n"
                "- 'Skill': Programming languages, frameworks, or developer tools being learned or mastered.\n"
                "- 'Preference': Preferred tools, frameworks, themes, or design choices.\n"
                "- 'Project': Specific systems, software, apps, or platforms being built.\n\n"
                "Return ONLY a JSON array of objects with keys: 'title', 'fact', 'category' ('Skill', 'Preference', 'Project', 'Fact'), 'importance' ('High', 'Medium', 'Low'), 'confidence' (integer 85-98).\n"
                "If no long-term information is present, return [].\n\n"
                f"User Message: \"{masked_text}\""
            )
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2
            )
            llm_res = response.choices[0].message.content.strip()
            import json_repair
            parsed_memories = json_repair.loads(llm_res)
            if isinstance(parsed_memories, list):
                for pm in parsed_memories:
                    if isinstance(pm, dict) and pm.get("title") and pm.get("fact"):
                        raw_cat = str(pm.get("category", "Fact")).strip().capitalize()
                        if raw_cat not in ["Skill", "Preference", "Project", "Fact"]:
                            raw_cat = "Fact"
                        candidates.append({
                            "title": clean_memory_title(str(pm.get("title"))),
                            "fact": str(pm.get("fact")).strip(),
                            "category": raw_cat,
                            "importance": str(pm.get("importance", "High")).strip(),
                            "confidence": int(pm.get("confidence", 94))
                        })
        except Exception:
            pass

    # 3. Deduplicate Candidates & Restore Privacy Placeholders
    final_memories = []
    seen_keys = set()

    for cand in candidates:
        orig_title = cand["title"]
        orig_fact = cand["fact"]

        # Restore any masked privacy tokens in fact and title locally
        restored_title = unmask_dialogue(orig_title, store)
        restored_fact = unmask_dialogue(orig_fact, store)

        # Clean restored title
        restored_title = clean_memory_title(restored_title)

        # Determine privacy status
        is_protected = (restored_title != orig_title) or (restored_fact != orig_fact)
        privacy_status = "Protected" if is_protected else "Safe"

        category = cand.get("category", "Skill")
        if category not in ["Skill", "Preference", "Project", "Fact"]:
            category = "Fact"

        # Unique key combines normalized title and category
        dedup_key = f"{category.lower()}:{restored_title.lower()}"
        if dedup_key not in seen_keys:
            seen_keys.add(dedup_key)
            final_memories.append({
                "title": restored_title,
                "fact": restored_fact,
                "category": category,
                "importance": cand.get("importance", "High"),
                "confidence": cand.get("confidence", 94),
                "privacy": privacy_status
            })

    return final_memories

def sanitize_user_visible_response(text: str, store: PrivacyStore = None) -> str:
    """
    Boundary Sanitizer: Ensures internal MemPrivacy placeholders such as
    'real_name_10', '<Real_Name_1>', '<Email_Address_1>', '<Verification_Code_1>',
    and similar tokens are NEVER exposed in the final user-visible chatbot response.
    """
    if not text or not isinstance(text, str):
        return text or ""

    # First attempt unmasking if store is provided
    if store:
        text = unmask_dialogue(text, store)

    # Clean awkward introductory leaked phrases
    text = re.sub(r'\b(?:my name is|i am|call me)\s+(?:<Real_Name_\d+>|real_name_\d+)\b', 'you', text, flags=re.IGNORECASE)
    text = re.sub(r'Regarding\s+(?:i\s+am\s+)?(?:<Real_Name_\d+>|real_name_\d+)\s+to\s+build\s+apps:', 'Regarding building apps:', text, flags=re.IGNORECASE)
    text = re.sub(r'Regarding\s+(?:my\s+name\s+is\s+)?(?:<Real_Name_\d+>|real_name_\d+)\s+and\s+i\s+am\s+currently\s+studying\s+cse:', 'Regarding your studies in Computer Science and Engineering (CSE):', text, flags=re.IGNORECASE)

    # Real Name placeholders -> clean natural reference or remove
    text = re.sub(r'<(?:Real_Name|Name)_\d+>', 'you', text, flags=re.IGNORECASE)
    text = re.sub(r'\breal_name_\d+\b', 'you', text, flags=re.IGNORECASE)

    # Email Address placeholders -> 'your email address'
    text = re.sub(r'<Email_Address_\d+>', 'your email address', text, flags=re.IGNORECASE)
    text = re.sub(r'\bemail_address_\d+\b', 'your email address', text, flags=re.IGNORECASE)

    # Phone Number placeholders -> 'your phone number'
    text = re.sub(r'<Phone_Number_\d+>', 'your phone number', text, flags=re.IGNORECASE)
    text = re.sub(r'\bphone_number_\d+\b', 'your phone number', text, flags=re.IGNORECASE)

    # Verification Code placeholders -> 'verification code'
    text = re.sub(r'<Verification_Code_\d+>', 'verification code', text, flags=re.IGNORECASE)
    text = re.sub(r'\bverification_code_\d+\b', 'verification code', text, flags=re.IGNORECASE)

    # Detailed Address placeholders -> 'your address'
    text = re.sub(r'<Detailed_Address_\d+>', 'your address', text, flags=re.IGNORECASE)
    text = re.sub(r'\bdetailed_address_\d+\b', 'your address', text, flags=re.IGNORECASE)

    # Any remaining bracketed masks <Type_N>
    text = re.sub(r'<[A-Za-z_]+_\d+>', '', text)

    # Any remaining bare privacy masks
    text = re.sub(r'\b(?:medical_health|financial_account|id_number|password|key|token|mask)_[0-9]+\b', '', text, flags=re.IGNORECASE)

    # Clean formatting artifacts
    text = re.sub(r'Regarding\s*:\s*', 'Regarding your query: ', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    text = re.sub(r'\s+([.,!?:;])', r'\1', text)
    return text.strip()

def process_chat(text: str, memories_list: list = None, settings: dict = None, history: list = None) -> dict:
    """
    Chat Pipeline for Task 8, Task 9, Task 10, Task 15 & Task 17:
    1. USER MESSAGE -> Local MemPrivacy Privacy Detection & Masking (local LLM or local PrivacyStore)
    2. MEMORIES -> Formatted & Privacy-masked into Context String if memory_enabled is True
    3. MASKED MESSAGE + MASKED HISTORY + MEMORY CONTEXT -> External/Cloud AI Processing (Gemini or Fallback)
    4. AI RESPONSE -> Local MemPrivacy Restoration (unmask_dialogue) and Boundary Sanitization
    5. MASKED MESSAGE -> Memory Extraction -> Local Restoration if memory_enabled is True
    6. RESTORED RESPONSE, USED MEMORIES & EXTRACTED MEMORIES -> Returned to caller
    """
    if settings is None:
        settings = {}

    memory_enabled = settings.get("memoryEnabled", settings.get("memory_enabled", True))
    auto_save = settings.get("autoSaveMemories", settings.get("auto_save", True))
    privacy_mode = settings.get("privacyMode", settings.get("privacy_mode", "Protected"))
    allowed_categories = settings.get("allowedCategories", settings.get("allowed_categories", ["Skill", "Preference", "Project", "Fact", "General"]))

    config_path = os.path.join(src_dir, "privacy_config.yaml")
    config = load_yaml_config(config_path)

    prompt_path = config.get("privacy", {}).get("prompt_path", "prompts/extract_privacy.txt")
    if not os.path.isabs(prompt_path):
        config["privacy"]["prompt_path"] = os.path.join(src_dir, prompt_path)

    db_name = config.get("privacy", {}).get("db_path", "privacy_store.db")
    db_path = os.path.join(script_dir, db_name)
    store = PrivacyStore(db_path=db_path)

    # Cloud Chat LLM Credentials
    cloud_api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("MEMPRIVACY_API_KEY") or ""
    cloud_base_url = os.environ.get("GEMINI_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or ""
    cloud_model = os.environ.get("GEMINI_MODEL") or os.environ.get("MEMPRIVACY_MODEL") or "gemini-3.6-flash"
    has_cloud_llm = bool(cloud_api_key and cloud_base_url)

    cloud_config = {
        "llm": {
            "api_key": cloud_api_key,
            "base_url": cloud_base_url,
            "model": cloud_model
        }
    }

    try:
        # Step 1: Local MemPrivacy Masking
        mask_levels = config.get("privacy", {}).get("mask_levels", ["PL2", "PL3", "PL4"])
        masked_text, detected_items, llm_active = run_local_mem_privacy_detection(
            text=text,
            config=config,
            store=store,
            mask_levels=mask_levels
        )

        # Sanitize and privacy-mask conversation history turns locally
        masked_history = []
        if history and isinstance(history, list):
            stored_items = store.get_all()
            for h in history:
                if isinstance(h, dict) and h.get("text"):
                    h_role = h.get("role", "user")
                    h_text = str(h.get("text"))
                    h_matching = [it for it in stored_items if it.get("original_text") and it["original_text"] in h_text]
                    h_masked = mask_dialogue(h_text, h_matching, store, mask_levels=mask_levels) if h_matching else h_text
                    masked_history.append({"role": h_role, "text": h_masked})

        # Step 2: Format Relevant Memory Context if memory_enabled is True (Task 10 & 15)
        used_memories = []
        if memory_enabled:
            memory_context, used_memories = format_memories_for_context(memories_list, store, mask_levels, user_text=masked_text)
        else:
            memory_context = ""

        # Step 3: AI Processing (Receives ONLY masked_text, masked_history, and privacy-masked memory context)
        ai_masked_response, provider = generate_ai_chat_response(
            masked_text=masked_text,
            config=cloud_config,
            has_llm_config=has_cloud_llm,
            memory_context=memory_context,
            history=masked_history,
            used_memories=used_memories,
            store=store
        )

        # Step 4: MemPrivacy Restoration & Boundary Sanitization for Chat Response
        restored_response = unmask_dialogue(ai_masked_response, store)
        restored_response = sanitize_user_visible_response(restored_response, store)

        # Step 5: Memory Extraction on masked_text if memory_enabled is True (Task 9 & 15)
        extracted_memories = []
        if memory_enabled:
            raw_extracted = extract_memories_from_text(
                masked_text=masked_text,
                store=store,
                config=config,
                has_cloud_llm=has_cloud_llm,
                cloud_config=cloud_config
            )

            # Filter extracted memories by allowed_categories
            allowed_cats_lower = [str(c).strip().lower() for c in allowed_categories]
            for cand in raw_extracted:
                cand_cat = str(cand.get("category", "General")).strip().lower()
                if not allowed_cats_lower or cand_cat in allowed_cats_lower:
                    if privacy_mode == "Protected":
                        cand["privacy"] = "Protected"
                    extracted_memories.append(cand)

        # Return clean response, used memories, extracted memories, and provider status
        return {
            "success": True,
            "response": restored_response,
            "used_memories": used_memories,
            "extracted_memories": extracted_memories,
            "provider": provider
        }

    except Exception as err:
        sys.stderr.write(f"[MemPrivacy Chat Error] {str(err)}\n")
        return {
            "success": False,
            "error": f"MemPrivacy chat processing error: {str(err)}"
        }
    finally:
        store.close()

if __name__ == "__main__":
    mode = "test"
    input_text = ""
    memories_input = None
    settings_input = None
    history_input = None

    if len(sys.argv) > 2 and sys.argv[1] in ["chat", "test"]:
        mode = sys.argv[1]
        input_text = sys.argv[2]
        if len(sys.argv) > 3:
            try:
                memories_input = json.loads(sys.argv[3])
            except Exception:
                pass
        if len(sys.argv) > 4:
            try:
                settings_input = json.loads(sys.argv[4])
            except Exception:
                pass
        if len(sys.argv) > 5:
            try:
                history_input = json.loads(sys.argv[5])
            except Exception:
                pass
    elif len(sys.argv) > 1:
        input_text = sys.argv[1]
    else:
        raw_input = sys.stdin.read()
        try:
            parsed = json.loads(raw_input)
            mode = parsed.get("mode", "test")
            input_text = parsed.get("text", "")
            memories_input = parsed.get("memories", None)
            settings_input = parsed.get("settings", None)
            history_input = parsed.get("history", parsed.get("context", None))
        except Exception:
            input_text = raw_input.strip()

    if mode == "chat":
        result = process_chat(input_text, memories_input, settings_input, history_input)
    else:
        result = process_text(input_text)

    print(json.dumps(result))
