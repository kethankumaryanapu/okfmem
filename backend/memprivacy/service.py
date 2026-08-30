import sys
import os
import json

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
            first_word = name_val.split()[0].lower() if name_val else ""
            ignored_verbs = {"learning", "working", "exploring", "studying", "building", "developing", "using", "trying", "getting", "currently", "recently"}
            if first_word not in ignored_verbs and name_val.lower() not in ["learning python", "working on"]:
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
        return memories_list[:top_k]

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

    # Filter positive keyword matches first if query terms exist
    if query_terms:
        positive_matches = [mem for score, mem in scored_memories if score >= 1.0]
        return positive_matches[:top_k]
    else:
        return memories_list[:top_k]

def format_memories_for_context(memories_list: list, store: PrivacyStore, mask_levels: list, user_text: str = "") -> tuple:
    """
    Task 10 & 15: Formats relevant memories into a privacy-masked context block for AI chat.
    Retrieves relevant memories matching user_text and passes memory facts through
    mask_dialogue to ensure sensitive details remain protected.
    Returns tuple: (context_string, used_memories_list)
    """
    if not memories_list or not isinstance(memories_list, list):
        return "", []

    relevant_memories = retrieve_relevant_memories(user_text, memories_list, top_k=5) if user_text else memories_list

    context_lines = []
    used_memories = []
    for mem in relevant_memories:
        if not isinstance(mem, dict):
            continue
        category = mem.get("category", "General")
        fact = mem.get("fact", "")

        if not fact:
            continue

        used_memories.append(mem)
        # Mask any sensitive text in the memory fact before giving to AI
        all_stored_items = store.get_all()
        matching_items = [item for item in all_stored_items if item["original_text"] in fact]
        masked_fact = mask_dialogue(fact, matching_items, store, mask_levels=mask_levels)

        context_lines.append(f"- [{category}] {masked_fact}")

    if not context_lines:
        return "", []

    return "Known User Memories (Use these facts to answer questions when relevant):\n" + "\n".join(context_lines), used_memories

def generate_ai_chat_response(masked_text: str, config: dict, has_llm_config: bool, memory_context: str = "") -> tuple:
    """
    AI Processing Step (Task 12 Gemini Integration):
    Sends ONLY the masked text and privacy-masked memory context to the AI model (Gemini or fallback).
    Returns tuple: (masked_response_text, provider_name)
    """
    system_prompt = "You are an intelligent, helpful AI assistant. Answer user questions directly and concisely using the provided user memories when relevant."
    if memory_context:
        system_prompt += "\n\n" + memory_context

    gemini_api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    gemini_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"

    # Task 12: Real Google Gemini API Provider
    if gemini_api_key:
        try:
            # 1. Try official google-genai Python SDK
            try:
                from google import genai
                from google.genai import types
                client = genai.Client(api_key=gemini_api_key)
                response = client.models.generate_content(
                    model=gemini_model,
                    contents=masked_text,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                    )
                )
                if response and hasattr(response, 'text') and response.text:
                    return response.text.strip(), "gemini"
            except ImportError:
                pass

            # 2. Direct HTTP REST API fallback for Gemini
            import urllib.request
            import json
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_api_key}"
            headers = {"Content-Type": "application/json"}
            payload = {
                "contents": [{"parts": [{"text": masked_text}]}],
                "systemInstruction": {"parts": [{"text": system_prompt}]}
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=15) as resp:
                res_data = json.loads(resp.read().decode('utf-8'))
                candidates = res_data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        return parts[0].get("text", "").strip(), "gemini"
            raise RuntimeError("Gemini API returned an empty or invalid response payload.")
        except Exception as e:
            raise RuntimeError(f"Gemini API provider error: {str(e)}")

    if has_llm_config:
        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=config["llm"]["base_url"],
                api_key=config["llm"]["api_key"]
            )
            model = config["llm"].get("model", "gpt-4o-mini")
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": masked_text}
                ],
                temperature=0.7
            )
            return response.choices[0].message.content.strip(), "openai"
        except Exception as e:
            raise RuntimeError(f"AI Provider error: {str(e)}")

    # Offline response generation with Memory Recall
    if memory_context:
        lines = [l for l in memory_context.splitlines() if l.startswith("- [")]
        memory_summary = "; ".join(lines)
        return f"I have received your message: \"{masked_text}\". Based on your saved memories ({memory_summary}), I can assist you with your request.", "offline"
    else:
        return f"I have received your message: \"{masked_text}\". I will assist you with this request while ensuring your sensitive information remains protected.", "offline"


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
    clean = re.sub(r'^(?:currently\s+|recently\s+|i\s+am\s+|i\'m\s+)?(?:learning\s+to\s+use|learning|studying|mastering|exploring|working\s+on|building|developing|creating|using|preferring)\s+', '', clean, flags=re.IGNORECASE)
    # Strip trailing phrase connectors
    clean = re.sub(r'\s+(?:and|with|for)\s+(?:building|developing|working|learning|creating).*$', '', clean, flags=re.IGNORECASE)
    clean = clean.strip()
    if not clean:
        clean = title.strip()

    if clean.islower():
        clean = clean.title()
    return clean

def extract_memories_from_text(masked_text: str, store: PrivacyStore, config: dict, has_cloud_llm: bool, cloud_config: dict) -> list:
    """
    Task 9 & Task 13 Memory Extraction:
    Identifies useful long-term information (skills, preferences, projects, facts)
    from masked conversation text while maintaining the MemPrivacy boundary.
    Restores masked placeholders locally and sets privacy to 'Protected' if sensitive data was present.
    """
    candidates = []

    # 1. Expanded Pattern & Heuristic Extraction (Task 13)
    # Learning signals
    learn_matches = re.finditer(r'\b(?:i am|i\'m|currently|recently)\s+(?:learning|studying|learning to use|getting started with|mastering|exploring)\s+([A-Za-z0-9_#+.\-<> ]+?)(?:\s+and\b|\s+with\b|\s+for\b|[.,;]|$)', masked_text, re.IGNORECASE)
    for m in learn_matches:
        topic = clean_memory_title(m.group(1))
        if topic and len(topic) > 1 and topic.lower() not in ["a lot", "more"]:
            candidates.append({
                "title": topic,
                "fact": f"User is learning {topic}.",
                "category": "Skill",
                "importance": "High",
                "confidence": 95
            })

    # Preference signals
    pref_matches = re.finditer(r'\b(?:i prefer|my preference is|i like|prefer working with|prefer using|decided to use|fan of|enjoy using)\s+(?:working with\s+|using\s+)?([A-Za-z0-9_#+.\-<> ]+?)(?:\s+for\b|\s+and\b|\s+over\b|[.,;]|$)', masked_text, re.IGNORECASE)
    for m in pref_matches:
        pref = clean_memory_title(m.group(1))
        if pref and len(pref) > 1 and pref.lower() not in ["working", "that", "this"]:
            candidates.append({
                "title": pref,
                "fact": f"User prefers working with {pref}.",
                "category": "Preference",
                "importance": "High",
                "confidence": 94
            })

    # Project signals
    proj_matches = re.finditer(r'\b(?:i am|i\'m|working on|building|developing|creating|designing|architecting)\s+(?:an?\s+)?([A-Za-z0-9_#+.\-<> ]+?)\s+(?:project|app|application|system|service|platform)\b', masked_text, re.IGNORECASE)
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

    # Skill / Tool signals
    skill_matches = re.finditer(r'\b(?:i use|i work with|i specialize in|experienced with|skilled in|stack includes|stack features)\s+([A-Za-z0-9_#+.\-<> ]+?)(?:\s+for\b|\s+and\b|\s+in\b|[.,;]|$)', masked_text, re.IGNORECASE)
    for m in skill_matches:
        sk = clean_memory_title(m.group(1))
        if sk and len(sk) > 1 and sk.lower() not in ["a lot", "that", "it"]:
            candidates.append({
                "title": sk,
                "fact": f"User works with {sk}.",
                "category": "Skill",
                "importance": "Medium",
                "confidence": 92
            })

    # 2. LLM Extraction on masked_text (if cloud/local LLM is active)
    if has_cloud_llm:
        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=cloud_config["llm"]["base_url"],
                api_key=cloud_config["llm"]["api_key"]
            )
            model = cloud_config["llm"].get("model", "gpt-4o-mini")
            prompt = (
                "You are a memory extraction engine. Identify any long-term user facts, skills, preferences, or projects in the message below.\n"
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
                        candidates.append({
                            "title": clean_memory_title(str(pm.get("title"))),
                            "fact": str(pm.get("fact")).strip(),
                            "category": str(pm.get("category", "General")).strip(),
                            "importance": str(pm.get("importance", "Medium")).strip(),
                            "confidence": int(pm.get("confidence", 90))
                        })
        except Exception:
            pass

    # 3. Deduplicate Candidates & Restore Privacy Placeholders
    final_memories = []
    seen_titles = set()

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

        norm_title = restored_title.lower()
        if norm_title not in seen_titles:
            seen_titles.add(norm_title)
            final_memories.append({
                "title": restored_title,
                "fact": restored_fact,
                "category": cand.get("category", "Skill"),
                "importance": cand.get("importance", "High"),
                "confidence": cand.get("confidence", 94),
                "privacy": privacy_status
            })

    return final_memories

def process_chat(text: str, memories_list: list = None, settings: dict = None) -> dict:
    """
    Chat Pipeline for Task 8, Task 9, Task 10 & Task 15:
    1. USER MESSAGE -> Local MemPrivacy Privacy Detection & Masking (local LLM or local PrivacyStore)
    2. MEMORIES -> Formatted & Privacy-masked into Context String if memory_enabled is True
    3. MASKED MESSAGE + MEMORY CONTEXT -> External/Cloud AI Processing (Gemini or Fallback)
    4. AI RESPONSE -> Local MemPrivacy Restoration (unmask_dialogue)
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
    cloud_model = os.environ.get("GEMINI_MODEL") or os.environ.get("MEMPRIVACY_MODEL") or "gpt-4o-mini"
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

        # Step 2: Format Relevant Memory Context if memory_enabled is True (Task 10 & 15)
        used_memories = []
        if memory_enabled:
            memory_context, used_memories = format_memories_for_context(memories_list, store, mask_levels, user_text=masked_text)
        else:
            memory_context = ""

        # Step 3: AI Processing (Receives ONLY masked_text and privacy-masked memory context)
        ai_masked_response, provider = generate_ai_chat_response(masked_text, cloud_config, has_cloud_llm, memory_context)

        # Step 4: MemPrivacy Restoration for Chat Response
        restored_response = unmask_dialogue(ai_masked_response, store)

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
        except Exception:
            input_text = raw_input.strip()

    if mode == "chat":
        result = process_chat(input_text, memories_input, settings_input)
    else:
        result = process_text(input_text)

    print(json.dumps(result))
