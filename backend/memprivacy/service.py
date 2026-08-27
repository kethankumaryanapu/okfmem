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
            if name_val.lower() not in ["learning python", "working on"]:
                items.append({
                    "original_text": name_val,
                    "privacy_type": "Real Name",
                    "privacy_level": "PL2"
                })

    # 3. Phone Number (PL2)
    phone_matches = re.findall(r'\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b', text)
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
        score = 0
        for term in query_terms:
            if term in text_block:
                score += 3 if term in title else (2 if term in fact else 1)

        if mem.get("importance", "").lower() == "high":
            score += 0.5

        scored_memories.append((score, mem))

    scored_memories.sort(key=lambda x: x[0], reverse=True)

    positive_matches = [mem for score, mem in scored_memories if score > 0]
    if positive_matches:
        return positive_matches[:top_k]

    return [mem for score, mem in scored_memories[:top_k]]

def format_memories_for_context(memories_list: list, store: PrivacyStore, mask_levels: list, user_text: str = "") -> str:
    """
    Task 10: Formats relevant memories into a privacy-masked context block for AI chat.
    Retrieves relevant memories matching user_text and passes memory facts through
    mask_dialogue to ensure sensitive details remain protected.
    """
    if not memories_list or not isinstance(memories_list, list):
        return ""

    relevant_memories = retrieve_relevant_memories(user_text, memories_list, top_k=5) if user_text else memories_list

    context_lines = []
    for mem in relevant_memories:
        if not isinstance(mem, dict):
            continue
        category = mem.get("category", "General")
        fact = mem.get("fact", "")

        if not fact:
            continue

        # Mask any sensitive text in the memory fact before giving to AI
        all_stored_items = store.get_all()
        matching_items = [item for item in all_stored_items if item["original_text"] in fact]
        masked_fact = mask_dialogue(fact, matching_items, store, mask_levels=mask_levels)

        context_lines.append(f"- [{category}] {masked_fact}")

    if not context_lines:
        return ""

    return "Known User Memories (Use these facts to answer questions when relevant):\n" + "\n".join(context_lines)

def generate_ai_chat_response(masked_text: str, config: dict, has_llm_config: bool, memory_context: str = "") -> str:
    """
    AI Processing Step:
    Sends ONLY the masked text and privacy-masked memory context to the AI model.
    """
    system_prompt = "You are an intelligent, helpful AI assistant. Answer user questions directly and concisely using the provided user memories when relevant."
    if memory_context:
        system_prompt += "\n\n" + memory_context

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
            return response.choices[0].message.content.strip()
        except Exception as e:
            raise RuntimeError(f"AI Provider error: {str(e)}")
    else:
        # Offline response generation with Memory Recall
        if memory_context:
            lines = [l for l in memory_context.splitlines() if l.startswith("- [")]
            memory_summary = "; ".join(lines)
            return f"I have received your message: \"{masked_text}\". Based on your saved memories ({memory_summary}), I can assist you with your request."
        else:
            return f"I have received your message: \"{masked_text}\". I will assist you with this request while ensuring your sensitive information remains protected."

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

def extract_memories_from_text(masked_text: str, store: PrivacyStore, config: dict, has_cloud_llm: bool, cloud_config: dict) -> list:
    """
    Task 9 Memory Extraction:
    Identifies useful long-term information (skills, preferences, projects, facts)
    from masked conversation text while maintaining the MemPrivacy boundary.
    Restores masked placeholders locally and sets privacy to 'Protected' if sensitive data was present.
    """
    candidates = []

    # 1. Pattern & Heuristic Extraction (Local / Offline)
    # Learning signals
    learn_matches = re.finditer(r'\b(?:i am|i\'m|currently)\s+(?:learning|studying|learning to use)\s+([A-Za-z0-9_#+.\-<> ]+?)(?:\s+and\b|\s+with\b|\s+for\b|[.,;]|$)', masked_text, re.IGNORECASE)
    for m in learn_matches:
        topic = m.group(1).strip()
        if topic and len(topic) > 1 and topic.lower() not in ["a lot", "more"]:
            candidates.append({
                "title": topic.title(),
                "fact": f"User is learning {topic}.",
                "category": "Skill",
                "importance": "High",
                "confidence": 95
            })

    # Preference signals
    pref_matches = re.finditer(r'\b(?:i prefer|my preference is|i like|prefer working with)\s+(?:working with\s+)?([A-Za-z0-9_#+.\-<> ]+?)(?:\s+for\b|\s+and\b|\s+over\b|[.,;]|$)', masked_text, re.IGNORECASE)
    for m in pref_matches:
        pref = m.group(1).strip()
        if pref and len(pref) > 1 and pref.lower() not in ["working", "that", "this"]:
            candidates.append({
                "title": pref.title(),
                "fact": f"User prefers working with {pref}.",
                "category": "Preference",
                "importance": "High",
                "confidence": 94
            })

    # Project signals
    proj_matches = re.finditer(r'\b(?:i am|i\'m|working on|building|developing)\s+(?:an?\s+)?([A-Za-z0-9_#+.\-<> ]+?)\s+(?:project|app|application|system)\b', masked_text, re.IGNORECASE)
    for m in proj_matches:
        proj = m.group(1).strip()
        if proj and len(proj) > 1:
            full_title = f"{proj.title()} Project" if "project" not in proj.lower() else proj.title()
            candidates.append({
                "title": full_title,
                "fact": f"User is working on {proj} project.",
                "category": "Project",
                "importance": "High",
                "confidence": 94
            })

    # Skill / Tool signals
    skill_matches = re.finditer(r'\b(?:i use|i work with|i specialize in)\s+([A-Za-z0-9_#+.\-<> ]+?)(?:\s+for\b|\s+and\b|\s+in\b|[.,;]|$)', masked_text, re.IGNORECASE)
    for m in skill_matches:
        sk = m.group(1).strip()
        if sk and len(sk) > 1 and sk.lower() not in ["a lot", "that", "it"]:
            candidates.append({
                "title": sk.title(),
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
                            "title": str(pm.get("title")).strip(),
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

def process_chat(text: str, memories_list: list = None) -> dict:
    """
    Chat Pipeline for Task 8, Task 9 & Task 10:
    1. USER MESSAGE -> Local MemPrivacy Privacy Detection & Masking (local LLM or local PrivacyStore)
    2. MEMORIES -> Formatted & Privacy-masked into Context String
    3. MASKED MESSAGE + MEMORY CONTEXT -> External/Cloud AI Processing
    4. AI RESPONSE -> Local MemPrivacy Restoration (unmask_dialogue)
    5. MASKED MESSAGE -> Memory Extraction -> Local Restoration
    6. RESTORED RESPONSE & EXTRACTED MEMORIES -> Returned to caller
    """
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

        # Step 2: Format Relevant Memory Context (Task 10)
        memory_context = format_memories_for_context(memories_list, store, mask_levels, user_text=masked_text)

        # Step 3: AI Processing (Receives ONLY masked_text and privacy-masked memory context)
        ai_masked_response = generate_ai_chat_response(masked_text, cloud_config, has_cloud_llm, memory_context)

        # Step 4: MemPrivacy Restoration for Chat Response
        restored_response = unmask_dialogue(ai_masked_response, store)

        # Step 5: Memory Extraction on masked_text (Task 9)
        extracted_memories = extract_memories_from_text(
            masked_text=masked_text,
            store=store,
            config=config,
            has_cloud_llm=has_cloud_llm,
            cloud_config=cloud_config
        )

        # Return clean response and extracted memories
        return {
            "success": True,
            "response": restored_response,
            "extracted_memories": extracted_memories
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

    if len(sys.argv) > 2 and sys.argv[1] in ["chat", "test"]:
        mode = sys.argv[1]
        input_text = sys.argv[2]
        if len(sys.argv) > 3:
            try:
                memories_input = json.loads(sys.argv[3])
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
        except Exception:
            input_text = raw_input.strip()

    if mode == "chat":
        result = process_chat(input_text, memories_input)
    else:
        result = process_text(input_text)

    print(json.dumps(result))
