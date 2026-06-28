import os
import json
import re
import logging
from contextvars import ContextVar
from typing import List, Dict, Any
from services.manual_bridge_service import manual_bridge_service

logger = logging.getLogger(__name__)
_LAST_CALL_META: ContextVar[Dict[str, Any] | None] = ContextVar("_LAST_CALL_META", default=None)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return default


def _count_selected_paths(selected_paths_json: str = "[]") -> int:
    try:
        selected_paths = json.loads(selected_paths_json or "[]")
    except Exception:
        selected_paths = []
    return len(selected_paths) if isinstance(selected_paths, list) else 0


STORY_GENERATION_PROMPT = """### [CONTEXT_CACHE_START]
# EXACT REQUIREMENT CHUNKS:
{full_srs_text}
### [CONTEXT_CACHE_END]

You are a Senior Technical Architect. Convert the selected requirements into the best Jira-ready hierarchy for implementation.

# SELECTED PATH JSON (legacy snapshot, keep only for compatibility):
{selected_path_json}

# SELECTED PATHS JSON:
{selected_paths_json}

# SELECTED PATHS OVERVIEW:
{selected_paths_overview}

# SELECTED REQUIREMENTS JSON:
{selected_requirements_json}

# CHUNK REFERENCES JSON:
{chunk_refs_json}

# SECTION REFERENCES JSON:
{section_refs_json}

# TEAM DIRECTORY:
{team_members_json}
/* Format: [{{"name": "Bob", "role": "Backend", "id": "USER-123"}}, ...] */

# PROJECT STATE (For Linking):
{active_jira_state}

# TASK:
1. Generate the most appropriate hierarchy required to implement the selected requirements.
2. Decide hierarchy depth dynamically using the selected requirements, exact chunks, project state, and user instructions.
3. Treat every object in SELECTED PATHS JSON as a mandatory planning lane.
4. Use SELECTED PATHS JSON as the source of truth. The legacy SELECTED PATH JSON is only a compatibility snapshot.
5. Generate exactly one epic for each selected path. Never collapse multiple selected paths into one epic.
6. For each selected path, generate 3 to 5 stories and 3 to 5 tasks.
7. For each story and each task, generate 2 to 3 subtasks.
8. Stories and tasks are siblings under the epic. Do not place tasks under stories.
9. Subtasks may belong to either a story or a task, but never to an epic.
10. Keep each selected path isolated as its own lane. Do not dump all issues into the first path.
11. Emit issues in path order. For each epic, list that epic's stories, tasks, and subtasks before moving to the next epic.
12. Map work items to team members by role, expertise, and likely ownership.
13. If a new item depends on existing work or Jira IDs, add explicit dependency links.
14. Use exact terms from the selected requirements, exact chunks, project state, and user instructions. Preserve domain terminology.
15. Preserve requirement traceability. Every issue must map back to one or more source requirements when relevant.
16. Write long, implementation-ready descriptions and rich, testable acceptance criteria.
17. Place items in a sensible sprint or backlog position based on current progress, dependencies, and urgency.
18. Preserve parent-child relationships explicitly and do not flatten nested work.

# OUTPUT RULES:
- Return ONLY a JSON object.
- Return compact JSON with no markdown fences and no commentary.
- Keep descriptions and acceptance criteria implementation-ready but concise enough that the full JSON can close correctly.
- Do not include literal newline characters inside JSON string values. Use normal sentence spacing inside strings.
- Include "Acceptance Criteria" as a checklist for QA.
- Ensure "summary" is concise and "description" is technical, detailed, and specific.
- Do not optimize for brevity; optimize for complete coverage of the selected scope.
- Keep all JSON values dynamic. Do not copy static example values into the final output.
- Do not use hardcoded parent indices, fixed IDs, or repeated assignee names.
- Balance assignee assignment evenly across the available team members.
- If a field depends on hierarchy position, derive it from the current epic or item index.
- Use the selected path order from SELECTED PATHS JSON when assigning planning_path_index values.
- Every Story and Task must include a unique dynamic temp_id, such as a path-aware id derived from its own position.
- Every Subtask parent_temp_id must exactly match an emitted Story temp_id or Task temp_id.

# JSON STRUCTURE:
{{
    "issues": [
        {{
            "type": "Epic",
            "summary": "...",
            "description": "...",
            "assignee": "<dynamic user id or empty>",
            "planning_path_id": "<selected path id>",
            "planning_path_index": "<zero-based selected path index>",
            "priority": "High",
            "links": [{{ "type": "<dynamic link type>", "outwardIssue": "<dynamic jira key or temp id>" }}],
            "acceptance_criteria": ["...", "..."]
        }},
        {{
            "type": "Story",
            "temp_id": "<dynamic story temp id>",
            "parent_epic_index": "<zero-based epic index>",
            "planning_path_id": "<selected path id>",
            "planning_path_index": "<zero-based selected path index>",
            "summary": "...",
            "description": "...",
            "assignee": "<dynamic user id or empty>",
            "acceptance_criteria": ["..."]
        }},
        {{
            "type": "Task",
            "temp_id": "<dynamic task temp id>",
            "parent_epic_index": "<zero-based epic index>",
            "planning_path_id": "<selected path id>",
            "planning_path_index": "<zero-based selected path index>",
            "summary": "...",
            "description": "...",
            "assignee": "<dynamic user id or empty>",
            "priority": "High",
            "links": [{{ "type": "<dynamic link type>", "outwardIssue": "<dynamic jira key or temp id>" }}],
            "acceptance_criteria": ["..."]
        }},
        {{
            "type": "Subtask",
            "temp_id": "<dynamic subtask temp id>",
            "parent_temp_id": "<dynamic story or task temp id>",
            "planning_path_id": "<selected path id>",
            "planning_path_index": "<zero-based selected path index>",
            "summary": "...",
            "description": "...",
            "assignee": "<dynamic user id or empty>",
            "priority": "Medium",
            "acceptance_criteria": ["..."]
        }}
    ]
}}"""


CODE_ANALYSIS_PROMPT = """You are a code analysis AI. Determine if the following code changes satisfy a user story's acceptance criteria.

Story: {story_title}

Acceptance Criteria:
{acceptance_criteria}

Code Diff:
{code_diff}

Commit Message: {commit_message}

Analyze whether the code changes implement this story. Return ONLY valid JSON:

{{
  "status": "done|partial|not_started",
  "reasoning": "Brief explanation of your decision",
  "evidence": [
    {{
      "filePath": "src/example.js",
      "lineStart": 1,
      "lineEnd": 10,
      "description": "Implements the login form validation"
    }}
  ],
  "criteriamet": ["Criterion that is met", ...]
}}

Status guide:
- "done": All acceptance criteria clearly met by the code
- "partial": Some criteria met but not all
- "not_started": No evidence of implementation in changes"""


JIRA_SUMMARY_PROMPT = """You are a technical program manager AI.

Project: {project_key}
Issue Snapshot:
{issues_text}

Return ONLY valid JSON with this shape:
{{
  "summary": "2-4 sentence project summary",
  "topRisks": ["risk 1", "risk 2"],
  "nextActions": ["action 1", "action 2", "action 3"]
}}

Rules:
- Keep concise and practical.
- Mention blockers, overdue/aging work, and priority imbalance.
- Do not include markdown."""


PLANNER_SUGGEST_PROMPT = """You are an Elite Agile Product Manager running a discovery phase.

Requirement Graph (Master Index JSON):
{requirement_map_json}

Current Project State JSON:
{project_state_json}

Module Focus: {module_name}
User Instruction: {user_input}

Task:
1. Compare the requirement graph against current project state.
2. Identify the highest-value planning paths to explore next.
3. Prefer paths with clear dependency order and active business impact.
4. Return planning paths only. Do not generate backlog items.

Output rules:
- Return ONLY valid JSON.
- Return requirement IDs exactly as provided in the graph.
- No markdown, no commentary.

JSON shape:
{{
    "paths": [
        {{
            "id": "auth-foundation",
            "name": "Authentication Foundation",
            "reason": "One short sentence explaining selection strategy",
            "requirements": ["FR-AUTH-001", "FR-AUTH-002"],
            "priority": "high",
            "dependency_notes": "Why this path should be worked next"
        }}
    ]
}}
"""


DISCOVERY_GAPS_PROMPT = """You are a requirements discovery analyst.

Requirement Graph (Master Index JSON):
{requirement_map_json}

Completed Jira IDs JSON:
{completed_jira_ids_json}

Current Project State JSON:
{project_state_json}

Module Focus: {module_name}
User Instruction: {user_input}

Task:
1. Compare the requirement graph against completed Jira IDs and current project state.
2. Determine completed, partially completed, blocked, and missing requirements.
3. Output planning paths that explain what should be worked on next.
4. If project state is mostly empty/early, prioritize foundational major requirements first.
5. If major requirements are complete, prioritize remaining major gaps, blocked dependencies, and high-value minor items.
6. Prefer paths with visible dependency impact and sequencing value.

Output rules:
- Return ONLY valid JSON.
- Return requirement IDs exactly as provided in the graph.
- No markdown, no commentary.

JSON shape:
{{
    "paths": [
        {{
            "id": "auth-foundation",
            "name": "Authentication Foundation",
            "reason": "One short sentence explaining selection strategy based on state and graph",
            "requirements": ["FR-AUTH-001", "NFR-SEC-002"],
            "priority": "high",
            "dependency_notes": "Blocked by missing auth infrastructure"
        }}
    ]
}}
"""


REQUIREMENT_EXTRACTION_PROMPT = """Extract structured requirements from the following SRS.

Return ONLY valid JSON with this shape:
{{
        "functional_requirements": ["FR-XXX-001: ..."],
        "non_functional_requirements": ["NFR-XXX-001: ..."],
        "modules": ["..."],
        "actors": ["..."]
}}

Rules:
- Keep requirements concise and deduplicated
- Preserve requirement IDs like FR-1 / NFR-2 if present and normalize them consistently
- If IDs are missing, generate deterministic IDs using FR-<MODULE>-### and NFR-<CATEGORY>-###
- Every extracted requirement line must include its explicit ID prefix
- Do not invent modules or actors

SRS:
{srs_text}
"""


PHASE_ACTION_SUGGEST_PROMPT = """You are an Elite Agile Product Manager.

Targeted SRS Chunks (already filtered by requirement IDs):
{fetched_srs_chunks}

Current Project State JSON:
{project_state_json}

User Instruction:
{user_custom_instruction}

Task:
Determine the highest-value planning paths based on the requirement graph, project state, completed work, and dependencies.

Rules:
- Do not generate backlog items.
- Do not generate stories.
- Do not generate tasks.
- Use mixed planning-path coverage across major areas of the product.
- Every path must reference relevant requirement IDs.
- Explain why now using project-state dependency/progress signals when possible.
- Keep each path specific and actionable.
- Include enough detail for the next generation step to expand the work without guessing.
- Avoid generic wording unless explicitly requested by the user instruction.

Return ONLY valid JSON:
{{
    "paths": [
        {{
            "id": "auth-foundation",
            "name": "Authentication Foundation",
            "reason": "High-value auth gaps remain and depend on identity infrastructure already in progress.",
            "requirements": ["FR-AUTH-001", "FR-AUTH-002"],
            "priority": "high",
            "dependency_notes": "Blocks login, session, and security work"
        }}
    ]
}}
"""


STANDUP_SUMMARY_PROMPT = """You are an engineering manager assistant.

Create a concise summary from the following project context.

Follow the output format requested in the context. If the context asks for JSON, return ONLY valid JSON (no markdown fences, no extra text). If no specific format is requested, return plain text with 3 short sections:
1) What moved
2) What is pending
3) Health and risk

Context:
{context}
"""


class LLMService:
    """
    Uses OpenRouter (https://openrouter.ai) which provides FREE AI models.
    Set OPENROUTER_API_KEY in .env — free signup, no credit card needed.
    Free model: google/gemini-2.0-flash-exp:free
    """
    def __init__(self):
        self.model = os.getenv("LLM_MODEL", "google/gemini-2.0-flash-exp:free")
        self.max_tokens = int(os.getenv("MAX_TOKENS", 8192))
        self._client = None

    @staticmethod
    def _normalize_usage(response: Any) -> Dict[str, int]:
        usage = getattr(response, "usage", None)
        if usage is None and isinstance(response, dict):
            usage = response.get("usage")

        def _read(src: Any, key: str) -> int:
            if src is None:
                return 0
            if isinstance(src, dict):
                return int(src.get(key) or 0)
            return int(getattr(src, key, 0) or 0)

        return {
            "prompt_tokens": _read(usage, "prompt_tokens"),
            "completion_tokens": _read(usage, "completion_tokens"),
            "total_tokens": _read(usage, "total_tokens"),
            "prompt_cache_hit_tokens": _read(usage, "prompt_cache_hit_tokens"),
            "prompt_cache_miss_tokens": _read(usage, "prompt_cache_miss_tokens"),
        }

    @staticmethod
    def _trim_meta_text(value: Any, max_chars: int = 1200) -> str:
        text = str(value or "").strip()
        if len(text) <= max_chars:
            return text
        return text[:max_chars] + " ...[truncated]"

    def _set_last_call_meta(self, meta: Dict[str, Any]):
        _LAST_CALL_META.set(meta)

    def get_last_call_meta(self) -> Dict[str, Any] | None:
        return _LAST_CALL_META.get()

    def _get_client(self):
        if not self._client:
            from openai import OpenAI
            api_key = os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY")
            self._client = OpenAI(
                api_key=api_key,
                base_url="https://openrouter.ai/api/v1",
                default_headers={
                    "HTTP-Referer": "http://localhost:5173",
                    "X-Title": "DevTrack AI",
                },
            )
        return self._client

    def _get_openrouter_client(self, api_key: str):
        from openai import OpenAI
        return OpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "DevTrack AI",
            },
        )

    def _get_deepseek_client(self, base_url: str):
        from openai import OpenAI
        api_key = os.getenv("DEEPSEEK_LOCAL_API_KEY") or os.getenv("OPENAI_API_KEY") or "not-needed"

        normalized = (base_url or "").strip()
        if normalized and not normalized.rstrip("/").endswith("/v1"):
            normalized = f"{normalized.rstrip('/')}/v1"

        return OpenAI(
            api_key=api_key,
            base_url=normalized,
        )

    def _get_deepseek_official_client(self):
        from openai import OpenAI
        api_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("DeepSeek API key is not configured")

        return OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com",
        )

    @staticmethod
    def _extract_text_from_chat_response(response: Any) -> str:
        """Extract plain text from OpenAI-compatible chat responses across providers."""
        if response is None:
            return ""

        # Newer SDKs sometimes expose consolidated output text.
        output_text = getattr(response, "output_text", None)
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()

        choices = getattr(response, "choices", None)
        if isinstance(choices, list) and choices:
            first = choices[0]

            message = getattr(first, "message", None)
            if message is not None:
                content = getattr(message, "content", None)
                if isinstance(content, str) and content.strip():
                    return content.strip()

                if isinstance(content, list):
                    pieces = []
                    for item in content:
                        if isinstance(item, str) and item.strip():
                            pieces.append(item.strip())
                        elif isinstance(item, dict):
                            text = (item.get("text") or item.get("content") or "")
                            if isinstance(text, str) and text.strip():
                                pieces.append(text.strip())
                        else:
                            part_text = getattr(item, "text", None)
                            if isinstance(part_text, str) and part_text.strip():
                                pieces.append(part_text.strip())
                    if pieces:
                        return "\n".join(pieces).strip()

            text = getattr(first, "text", None)
            if isinstance(text, str) and text.strip():
                return text.strip()

            delta = getattr(first, "delta", None)
            if delta is not None:
                delta_content = getattr(delta, "content", None)
                if isinstance(delta_content, str) and delta_content.strip():
                    return delta_content.strip()

        # Last-resort dictionary traversal for provider-specific objects.
        response_dict = None
        if hasattr(response, "model_dump"):
            try:
                response_dict = response.model_dump()
            except Exception:
                response_dict = None
        if response_dict is None and hasattr(response, "to_dict"):
            try:
                response_dict = response.to_dict()
            except Exception:
                response_dict = None

        if isinstance(response_dict, dict):
            choices_dict = response_dict.get("choices") or []
            if isinstance(choices_dict, list) and choices_dict:
                first = choices_dict[0] or {}
                if isinstance(first, dict):
                    message = first.get("message") or {}
                    if isinstance(message, dict):
                        content = message.get("content")
                        if isinstance(content, str) and content.strip():
                            return content.strip()
                    text = first.get("text")
                    if isinstance(text, str) and text.strip():
                        return text.strip()

        return ""

    # Free models to try in order if one is rate-limited or unavailable
    FREE_MODELS = [
        "google/gemma-3-27b-it:free",
        "google/gemma-3-12b-it:free",
        "google/gemma-3-9b-it:free",
        "mistralai/mistral-7b-instruct:free",
        "meta-llama/llama-3.3-70b-instruct:free",
    ]

    MAX_INPUT_TOKENS = 7000

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        # A practical approximation for mixed English/JSON prompts.
        return max(1, (len(text or "") + 3) // 4)

    @staticmethod
    def _normalize_line(line: str) -> str:
        return re.sub(r"\s+", " ", (line or "").strip())

    def _line_score(self, line: str, module_name: str = "") -> int:
        text = (line or "").lower()
        score = 0
        if module_name and module_name.lower() in text:
            score += 3
        if re.search(r"\b(fr[-_ ]?\d+|nfr[-_ ]?\d+|requirement|acceptance|criterion|must|shall)\b", text):
            score += 3
        if re.search(r"\b(api|endpoint|workflow|state|status|role|permission|validation|integration|jira|github)\b", text):
            score += 2
        if re.search(r"\d", text):
            score += 1
        if len(text) > 40:
            score += 1
        return score

    def _select_salient_lines(self, text: str, max_chars: int, module_name: str = "") -> str:
        if not text:
            return ""

        lines = [self._normalize_line(line) for line in text.splitlines()]
        lines = [line for line in lines if line]

        seen = set()
        candidates = []
        for idx, line in enumerate(lines):
            key = line.lower()
            if key in seen:
                continue
            seen.add(key)
            candidates.append((idx, self._line_score(line, module_name), line))

        selected = []
        used = 0
        for threshold in [5, 4, 3, 2, 1, 0]:
            tier = [item for item in candidates if item[1] >= threshold and item[2] not in selected]
            tier.sort(key=lambda x: x[0])
            for _, _, line in tier:
                add_len = len(line) + 1
                if used + add_len > max_chars:
                    continue
                selected.append(line)
                used += add_len
            if used >= max_chars:
                break

        if not selected and candidates:
            return self._trim_text(candidates[0][2], max_chars)
        return "\n".join(selected)

    def _compact_rag_context(self, context: str, max_chars: int, module_name: str) -> str:
        if not context:
            return "No SRS document ingested yet."

        chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n", context) if chunk.strip()]
        if not chunks:
            return self._select_salient_lines(context, max_chars, module_name)

        scored = []
        for i, chunk in enumerate(chunks):
            score = 0
            low = chunk.lower()
            if module_name and module_name.lower() in low:
                score += 4
            if re.search(r"\b(fr[-_ ]?\d+|nfr[-_ ]?\d+|must|shall|acceptance|workflow|actor|role|state|api)\b", low):
                score += 3
            score += min(len(chunk) // 300, 2)
            scored.append((i, score, chunk))

        scored.sort(key=lambda x: (-x[1], x[0]))

        picked = []
        used = 0
        for original_idx, _, chunk in scored:
            chunk_text = self._select_salient_lines(chunk, 1200, module_name)
            if not chunk_text:
                continue
            add_len = len(chunk_text) + 2
            if used + add_len > max_chars:
                continue
            picked.append((original_idx, chunk_text))
            used += add_len
            if used >= max_chars:
                break

        if not picked:
            return self._select_salient_lines(context, max_chars, module_name)

        # Restore source order for readability.
        ordered = [chunk_text for _, chunk_text in sorted(picked, key=lambda item: item[0])]
        return "\n\n".join(ordered)

    def _extract_vectorless_summary(self, additional_context: str, module_name: str, max_chars: int) -> str:
        marker = "Vectorless project graph context:"
        text = additional_context or ""
        if marker not in text:
            return self._select_salient_lines(text, max_chars, module_name)

        pre = text.split(marker, 1)[0].strip()
        post = text.split(marker, 1)[1].strip()

        # Parse the first JSON object after the marker.
        graph_obj = None
        try:
            json_start = post.find("{")
            if json_start >= 0:
                decoder = json.JSONDecoder()
                graph_obj, _ = decoder.raw_decode(post[json_start:])
        except Exception:
            graph_obj = None

        if not isinstance(graph_obj, dict):
            return self._select_salient_lines(text, max_chars, module_name)

        lines = []

        project = graph_obj.get("project") or {}
        stats = graph_obj.get("stats") or {}
        if project:
            lines.append(
                f"Project {project.get('name', '')} ({project.get('key', '')}) status={project.get('status', '')} completion={project.get('completionPercentage', 0)}%"
            )
        if stats:
            lines.append(
                "Project stats: "
                f"totalStories={stats.get('totalStories', 0)}, done={stats.get('doneStories', 0)}, "
                f"inProgress={stats.get('inProgressStories', 0)}, backlog={stats.get('backlogStories', 0)}, "
                f"activeSprints={stats.get('activeSprints', 0)}, recentCommits={stats.get('recentCommits', 0)}"
            )

        nodes = graph_obj.get("nodes") or {}
        docs = (nodes.get("documents") or [])[:2]
        if docs:
            lines.append("SRS evidence:")
            for doc in docs:
                snippet = self._trim_text(doc.get("snippet", ""), 420)
                lines.append(f"- {doc.get('title', 'document')} [{doc.get('status', 'unknown')}]: {snippet}")

        epics = (nodes.get("epics") or [])[:10]
        if epics:
            lines.append("Current epics:")
            for epic in epics:
                lines.append(
                    f"- {epic.get('title', '')} | status={epic.get('status', '')} | sprint={epic.get('sprint', '')} | priority={epic.get('priority', '')}"
                )

        stories = nodes.get("stories") or []
        prioritized_stories = [s for s in stories if s.get("status") in {"in_progress", "to_do", "approved"}][:25]
        if not prioritized_stories:
            prioritized_stories = stories[:15]
        if prioritized_stories:
            lines.append("Relevant stories/tasks:")
            for s in prioritized_stories:
                lines.append(
                    f"- {s.get('type', 'story')}: {s.get('title', '')} | status={s.get('status', '')} | sprint={s.get('sprint', '')} | priority={s.get('priority', '')}"
                )

        commits = (nodes.get("commits") or [])[:10]
        if commits:
            lines.append("Recent commit signals:")
            for c in commits:
                msg = self._trim_text(c.get("message", ""), 120)
                lines.append(f"- {c.get('author', 'unknown')}: {msg}")

        pre_filtered = self._select_salient_lines(pre, max(600, max_chars // 4), module_name)
        graph_filtered = self._select_salient_lines("\n".join(lines), max_chars, module_name)
        return "\n\n".join([part for part in [pre_filtered, graph_filtered] if part]).strip()

    def _build_generate_prompt_with_budget(
        self,
        project_name: str,
        module_name: str,
        context: str,
        additional_context: str,
        constraints: str,
        team_members_json: str = "[]",
        selected_path_json: str = "{}",
        selected_paths_json: str = "[]",
        selected_requirements_json: str = "[]",
        chunk_refs_json: str = "[]",
        section_refs_json: str = "[]",
    ) -> str:
        ctx_budget = 11000
        add_budget = 13000

        for _ in range(6):
            compact_context = self._compact_rag_context(context, ctx_budget, module_name)
            compact_additional = self._extract_vectorless_summary(additional_context, module_name, add_budget)
            selected_paths_overview = self._build_selected_paths_overview(
                selected_paths_json=selected_paths_json or "[]",
                selected_requirements_json=selected_requirements_json or "[]",
            )

            prompt = STORY_GENERATION_PROMPT.format(
                full_srs_text=compact_context or "No SRS document ingested yet.",
                selected_path_json=self._trim_text(selected_path_json or "{}", 12000),
                selected_paths_json=self._trim_text(selected_paths_json or "[]", 12000),
                selected_paths_overview=self._trim_text(selected_paths_overview or "No selected paths provided.", 12000),
                selected_requirements_json=self._trim_text(selected_requirements_json or "[]", 12000),
                chunk_refs_json=self._trim_text(chunk_refs_json or "[]", 12000),
                section_refs_json=self._trim_text(section_refs_json or "[]", 12000),
                team_members_json=team_members_json or "[]",
                active_jira_state=compact_additional or "[]",
            )

            token_estimate = self._estimate_tokens(prompt)
            if token_estimate <= self.MAX_INPUT_TOKENS:
                return prompt

            shrink_ratio = max(0.55, (self.MAX_INPUT_TOKENS / max(token_estimate, 1)) * 0.92)
            ctx_budget = max(1800, int(ctx_budget * shrink_ratio))
            add_budget = max(2200, int(add_budget * shrink_ratio))

        # Final defensive pass.
        compact_context = self._select_salient_lines(context or "", 5200, module_name)
        compact_additional = self._select_salient_lines(additional_context or "", 6200, module_name)
        selected_paths_overview = self._build_selected_paths_overview(
            selected_paths_json=selected_paths_json or "[]",
            selected_requirements_json=selected_requirements_json or "[]",
        )
        return STORY_GENERATION_PROMPT.format(
            full_srs_text=compact_context or "No SRS document ingested yet.",
            selected_path_json=self._trim_text(selected_path_json or "{}", 12000),
            selected_paths_json=self._trim_text(selected_paths_json or "[]", 12000),
            selected_paths_overview=self._trim_text(selected_paths_overview or "No selected paths provided.", 12000),
            selected_requirements_json=self._trim_text(selected_requirements_json or "[]", 12000),
            chunk_refs_json=self._trim_text(chunk_refs_json or "[]", 12000),
            section_refs_json=self._trim_text(section_refs_json or "[]", 12000),
            team_members_json=team_members_json or "[]",
            active_jira_state=compact_additional or "[]",
        )

    def _build_selected_paths_overview(
        self,
        selected_paths_json: str = "[]",
        selected_requirements_json: str = "[]",
    ) -> str:
        try:
            selected_paths = json.loads(selected_paths_json or "[]")
        except Exception:
            selected_paths = []
        if not isinstance(selected_paths, list):
            selected_paths = []

        try:
            selected_requirements = json.loads(selected_requirements_json or "[]")
        except Exception:
            selected_requirements = []
        if not isinstance(selected_requirements, list):
            selected_requirements = []

        requirements_by_path: Dict[str, List[str]] = {}
        for item in selected_requirements:
            if not isinstance(item, dict):
                continue
            path_id = str(item.get("planning_path_id") or item.get("path_id") or "").strip()
            req_id = str(item.get("requirement_id") or item.get("id") or "").strip()
            title = str(item.get("title") or "").strip()
            label = req_id if req_id else title
            if not path_id or not label:
                continue
            bucket = requirements_by_path.setdefault(path_id, [])
            if label not in bucket:
                bucket.append(label)

        lines = []
        for index, path in enumerate(selected_paths):
            if not isinstance(path, dict):
                continue
            path_id = str(path.get("id") or path.get("path_id") or f"path-{index + 1}").strip()
            name = str(path.get("name") or path.get("title") or path_id or f"Selected Path {index + 1}").strip()
            reqs = path.get("requirements") or path.get("requirement_ids") or requirements_by_path.get(path_id, [])
            if not isinstance(reqs, list):
                reqs = [str(reqs)] if str(reqs).strip() else []
            req_text = ", ".join([str(req).strip() for req in reqs if str(req).strip()]) or "none"
            reason = str(path.get("reason") or "").strip()
            dependency_notes = str(path.get("dependency_notes") or "").strip()
            lane_line = f"{index}. id={path_id} | name={name} | requirements={req_text}"
            if reason:
                lane_line += f" | reason={reason}"
            if dependency_notes:
                lane_line += f" | dependency_notes={dependency_notes}"
            lines.append(lane_line)

        return "\n".join(lines) if lines else "No selected paths provided."

    def preview_generate_stories_prompt(
        self,
        project_name: str,
        module_name: str,
        context: str,
        additional_context: str = "",
        constraints: str = "",
        team_members_json: str = "[]",
        selected_path_json: str = "{}",
        selected_paths_json: str = "[]",
        selected_requirements_json: str = "[]",
        chunk_refs_json: str = "[]",
        section_refs_json: str = "[]",
    ) -> str:
        return self._build_generate_prompt_with_budget(
            project_name=project_name,
            module_name=module_name,
            context=context or "",
            additional_context=additional_context or "",
            constraints=constraints or "",
            team_members_json=team_members_json or "[]",
            selected_path_json=selected_path_json or "{}",
            selected_paths_json=selected_paths_json or "[]",
            selected_requirements_json=selected_requirements_json or "[]",
            chunk_refs_json=chunk_refs_json or "[]",
            section_refs_json=section_refs_json or "[]",
        )

    @staticmethod
    def _trim_text(value: Any, max_chars: int) -> str:
        text = str(value or "")
        if len(text) <= max_chars:
            return text
        return text[:max_chars] + " ...[truncated]"

    def _compact_context_graph_for_prompt(
        self,
        context_graph: Dict[str, Any],
        max_json_chars: int = 9000,
        doc_snippet_chars: int = 2200,
        max_docs: int = 2,
    ) -> Dict[str, Any]:
        docs = []
        for doc in (context_graph or {}).get("documents", [])[:max_docs]:
            docs.append({
                "id": doc.get("id"),
                "name": doc.get("name"),
                "fileType": doc.get("fileType"),
                "snippet": self._trim_text(doc.get("snippet", ""), doc_snippet_chars),
            })

        compact = {
            "source": (context_graph or {}).get("source", "srs_only"),
            "documents": docs,
        }

        serialized = json.dumps(compact, separators=(",", ":"))
        if len(serialized) <= max_json_chars:
            return compact

        # If still too large, shrink each snippet proportionally.
        if docs:
            budget = max(600, max_json_chars - 1200)
            per_doc = max(350, budget // len(docs))
            for doc in docs:
                doc["snippet"] = self._trim_text(doc.get("snippet", ""), per_doc)

        return compact

    @staticmethod
    def _is_context_overflow_error(error: Exception) -> bool:
        msg = str(error).lower()
        checks = [
            "context length",
            "overflows",
            "maximum context length",
            "prompt is too long",
            "token limit",
        ]
        return any(item in msg for item in checks)

    @staticmethod
    def _extract_json_object(text: str) -> str:
        """Extract the first balanced JSON object from a model response."""
        start = text.find("{")
        if start < 0:
            raise ValueError("No JSON object found in model response")

        depth = 0
        in_string = False
        escape = False

        for idx in range(start, len(text)):
            ch = text[idx]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue

            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start:idx + 1]

        raise ValueError("Unbalanced JSON object in model response")

    @staticmethod
    def _clean_common_json_issues(text: str) -> str:
        text = text.strip()
        text = re.sub(r",(\s*[}\]])", r"\1", text)
        return text

    @staticmethod
    def _escape_control_chars_in_strings(text: str) -> str:
        result = []
        in_string = False
        escape = False
        for ch in text:
            if in_string:
                if escape:
                    result.append(ch)
                    escape = False
                    continue
                if ch == "\\":
                    result.append(ch)
                    escape = True
                    continue
                if ch == '"':
                    result.append(ch)
                    in_string = False
                    continue
                if ch == "\n":
                    result.append("\\n")
                    continue
                if ch == "\r":
                    result.append("\\r")
                    continue
                if ch == "\t":
                    result.append("\\t")
                    continue
                result.append(ch)
                continue

            result.append(ch)
            if ch == '"':
                in_string = True
        return "".join(result)

    @staticmethod
    def _chat_finish_reason(response: Any) -> str:
        choices = getattr(response, "choices", None)
        if isinstance(choices, list) and choices:
            return str(getattr(choices[0], "finish_reason", "") or "")
        if isinstance(response, dict):
            choices = response.get("choices")
            if isinstance(choices, list) and choices:
                first = choices[0] or {}
                return str(first.get("finish_reason") or "")
        return ""

    def _parse_model_json(self, raw: str, *, operation: str) -> Any:
        """Parse JSON from an LLM response with light recovery for common formatting mistakes."""
        candidates = []

        text = (raw or "").strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1] if text.count("```") >= 2 else text.strip("`")
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        candidates.append(text)
        candidates.append(self._escape_control_chars_in_strings(text))

        try:
            candidates.append(self._extract_json_object(text))
        except Exception:
            pass

        for candidate in candidates:
            for variant in (candidate, self._clean_common_json_issues(candidate)):
                try:
                    return json.loads(variant)
                except json.JSONDecodeError:
                    continue

        preview = self._trim_text(text, 500)
        logger.error(
            "LLM JSON parse failed operation=%s raw_chars=%s raw_tail=%s",
            operation,
            len(text),
            self._trim_text(text[-500:], 500),
        )
        raise ValueError(f"LLM returned invalid JSON for {operation}: {preview}")

    def _call_llm(
        self,
        prompt: str,
        temperature: float = 0.3,
        ai_config: Dict[str, Any] = None,
        operation: str = "llm_call",
    ) -> str:
        cfg = ai_config or {}
        provider = cfg.get("provider") or "openrouter"
        resolved_temperature = float(cfg.get("temperature", temperature))
        configured_max_tokens = int(cfg.get("maxTokens", self.max_tokens))
        if operation == "generate_stories":
            generate_max_tokens = int(os.getenv("GENERATE_STORIES_MAX_TOKENS", 32768))
            resolved_max_tokens = max(configured_max_tokens, generate_max_tokens)
        else:
            resolved_max_tokens = configured_max_tokens
        started_at = __import__("time").time()
        prompt_chars = len(prompt or "")
        logger.info(
            "[LLM] call start operation=%s provider=%s temperature=%s max_tokens=%s prompt_chars=%s",
            operation,
            provider,
            resolved_temperature,
            resolved_max_tokens,
            prompt_chars,
        )

        if provider == "manual_bridge":
            timeout_seconds = int(cfg.get("manualBridgeTimeoutSeconds") or os.getenv("MANUAL_BRIDGE_TIMEOUT_SECONDS") or 1800)
            result = manual_bridge_service.submit_and_wait(
                prompt=prompt,
                operation=operation,
                timeout_seconds=timeout_seconds,
                context={
                    "provider": provider,
                    "temperature": resolved_temperature,
                    "maxTokens": resolved_max_tokens,
                },
            )
            self._set_last_call_meta({
                "provider": provider,
                "model": (cfg.get("deepseekModel") if provider.startswith("deepseek") else cfg.get("openrouterModel")) or self.model,
                "operation": operation,
                "latencyMs": int((__import__("time").time() - started_at) * 1000),
                "usage": None,
                "request": {
                    "promptPreview": self._trim_meta_text(prompt),
                },
                "response": {
                    "textPreview": self._trim_meta_text(result),
                },
            })
            return result

        if provider == "deepseek_local":
            deepseek_url = (cfg.get("deepseekUrl") or os.getenv("DEEPSEEK_LOCAL_URL") or "").strip()
            if not deepseek_url:
                raise ValueError("DeepSeek local provider selected but no URL configured")

            deepseek_model = cfg.get("deepseekModel") or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            client = self._get_deepseek_client(deepseek_url)
            request_kwargs = {
                "model": deepseek_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": resolved_temperature,
                "max_tokens": resolved_max_tokens,
            }
            if operation == "generate_stories":
                request_kwargs["response_format"] = {"type": "json_object"}
            response = client.chat.completions.create(**request_kwargs)
            text = self._extract_text_from_chat_response(response)
            if text:
                finish_reason = self._chat_finish_reason(response)
                logger.info(
                    "[LLM] call complete operation=%s provider=%s model=%s output_chars=%s finish_reason=%s",
                    operation,
                    provider,
                    deepseek_model,
                    len(text),
                    finish_reason,
                )
                self._set_last_call_meta({
                    "provider": provider,
                    "model": deepseek_model,
                    "operation": operation,
                    "latencyMs": int((__import__("time").time() - started_at) * 1000),
                    "usage": self._normalize_usage(response),
                    "finishReason": finish_reason,
                    "request": {
                        "promptPreview": self._trim_meta_text(prompt),
                    },
                    "response": {
                        "textPreview": self._trim_meta_text(text),
                    },
                })
                return text
            raise ValueError("DeepSeek local provider returned an empty or unsupported response shape")

        if provider == "deepseek_api":
            deepseek_model = cfg.get("deepseekModel") or os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
            deepseek_thinking = cfg.get("deepseekThinking")
            if deepseek_thinking is None:
                deepseek_thinking = True
            deepseek_reasoning_effort = cfg.get("deepseekReasoningEffort") or "high"
            client = self._get_deepseek_official_client()
            request_kwargs = {
                "model": deepseek_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": resolved_temperature,
                "max_tokens": resolved_max_tokens,
                "extra_body": {"thinking": {"type": "enabled" if deepseek_thinking else "disabled"}},
            }
            if operation in ("generate_stories", "standup_summary"):
                request_kwargs["response_format"] = {"type": "json_object"}
            response = client.chat.completions.create(**request_kwargs)
            text = self._extract_text_from_chat_response(response)
            if text:
                finish_reason = self._chat_finish_reason(response)
                logger.info(
                    "[LLM] call complete operation=%s provider=%s model=%s output_chars=%s finish_reason=%s",
                    operation,
                    provider,
                    deepseek_model,
                    len(text),
                    finish_reason,
                )
                self._set_last_call_meta({
                    "provider": provider,
                    "model": deepseek_model,
                    "operation": operation,
                    "latencyMs": int((__import__("time").time() - started_at) * 1000),
                    "usage": self._normalize_usage(response),
                    "finishReason": finish_reason,
                    "request": {
                        "promptPreview": self._trim_meta_text(prompt),
                        "thinking": deepseek_thinking,
                        "reasoningEffort": deepseek_reasoning_effort,
                    },
                    "response": {
                        "textPreview": self._trim_meta_text(text),
                    },
                })
                return text
            raise ValueError("DeepSeek API provider returned an empty or unsupported response shape")

        key_name = cfg.get("openrouterKeyName") or "OPENROUTER_API_KEY"
        api_key = os.getenv(key_name) or os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OpenRouter API key is not configured")

        client = self._get_openrouter_client(api_key)
        selected_model = cfg.get("openrouterModel") or self.model

        request_kwargs = {
            "model": selected_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": resolved_temperature,
            "max_tokens": resolved_max_tokens,
        }
        if operation in ("generate_stories", "standup_summary"):
            request_kwargs["response_format"] = {"type": "json_object"}
        response = client.chat.completions.create(**request_kwargs)
        text = self._extract_text_from_chat_response(response)
        if text:
            finish_reason = self._chat_finish_reason(response)
            logger.info(
                "[LLM] call complete operation=%s provider=%s model=%s output_chars=%s finish_reason=%s",
                operation,
                provider,
                selected_model,
                len(text),
                finish_reason,
            )
            self._set_last_call_meta({
                "provider": provider,
                "model": selected_model,
                "operation": operation,
                "latencyMs": int((__import__("time").time() - started_at) * 1000),
                "usage": self._normalize_usage(response),
                "finishReason": finish_reason,
                "request": {
                    "promptPreview": self._trim_meta_text(prompt),
                },
                "response": {
                    "textPreview": self._trim_meta_text(text),
                },
            })
            return text
        raise ValueError("Provider returned an empty or unsupported response shape")

    def generate_stories(
        self,
        project_name: str,
        module_name: str,
        context: str,
        additional_context: str = "",
        constraints: str = "",
        team_members_json: str = "[]",
        selected_path_json: str = "{}",
        selected_paths_json: str = "[]",
        selected_requirements_json: str = "[]",
        chunk_refs_json: str = "[]",
        section_refs_json: str = "[]",
        ai_config: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        selected_path_count = _count_selected_paths(selected_paths_json)
        logger.info(
            "[generate_stories] start project=%s module=%s selected_paths=%s context_chars=%s additional_context_chars=%s",
            project_name,
            module_name,
            selected_path_count,
            len(context or ""),
            len(additional_context or ""),
        )
        prompt = self._build_generate_prompt_with_budget(
            project_name=project_name,
            module_name=module_name,
            context=context or "",
            additional_context=additional_context or "",
            constraints=constraints or "",
            team_members_json=team_members_json or "[]",
            selected_path_json=selected_path_json or "{}",
            selected_paths_json=selected_paths_json or "[]",
            selected_requirements_json=selected_requirements_json or "[]",
            chunk_refs_json=chunk_refs_json or "[]",
            section_refs_json=section_refs_json or "[]",
        )
        logger.info(
            "[generate_stories] prompt ready selected_paths=%s prompt_chars=%s estimated_tokens=%s",
            selected_path_count,
            len(prompt or ""),
            self._estimate_tokens(prompt or ""),
        )

        raw = self._call_llm(prompt, temperature=0.4, ai_config=ai_config, operation="generate_stories")
        logger.info("[generate_stories] raw response received chars=%s", len(raw or ""))

        result = self._parse_model_json(raw, operation="generate_stories")
        logger.info(
            "[generate_stories] parsed JSON type=%s keys=%s",
            type(result).__name__,
            list(result.keys()) if isinstance(result, dict) else [],
        )

        if isinstance(result, dict) and isinstance(result.get("issues"), list):
            logger.info("[generate_stories] converting issues payload issues=%s", len(result.get("issues") or []))
            result = self._convert_issue_payload_to_backlog(result, module_name, selected_paths_json)

        normalized = self._normalize_generated_backlog(result, module_name, team_members_json, selected_paths_json)
        logger.info(
            "[generate_stories] normalized counts epics=%s stories=%s tasks=%s subtasks=%s",
            len(normalized.get("epics", [])),
            len(normalized.get("stories", [])),
            len(normalized.get("tasks", [])),
            len(normalized.get("subtasks", [])),
        )
        self._validate_backlog_distribution(
            normalized=normalized,
            selected_paths_json=selected_paths_json,
        )
        logger.info("[generate_stories] validation complete selected_paths=%s", selected_path_count)
        return normalized

    def _convert_issue_payload_to_backlog(self, payload: Dict[str, Any], module_name: str, selected_paths_json: str = "[]") -> Dict[str, Any]:
        issues = payload.get("issues") or []
        try:
            selected_paths = json.loads(selected_paths_json or "[]")
        except Exception:
            selected_paths = []
        if not isinstance(selected_paths, list):
            selected_paths = []

        selected_path_count = max(1, len(selected_paths))
        epics = []
        stories = []
        tasks = []
        subtasks = []

        epic_count = 0
        story_count = 0
        task_count = 0
        subtask_count = 0
        story_lane_cursor = 0
        task_lane_cursor = 0
        subtask_lane_cursor = 0
        lane_parent_map: Dict[int, str] = {}

        def _coerce_index(value: Any, default: int = 0) -> int:
            if value is None:
                return default
            try:
                text = str(value).strip()
                if not text:
                    return default
                return int(text)
            except Exception:
                return default

        def _safe_int_local(value: Any, default: int = 0) -> int:
            try:
                return int(str(value).strip())
            except Exception:
                return default

        def _lane_index(issue: Dict[str, Any], fallback: int) -> int:
            explicit = issue.get("planning_path_index")
            if explicit is None:
                explicit = issue.get("parent_epic_index")
            if explicit is None:
                explicit = issue.get("parentEpicIndex")
            lane = _coerce_index(explicit, fallback)
            if selected_path_count <= 0:
                return max(0, lane)
            return max(0, min(lane, selected_path_count - 1))

        def _temp_id(issue: Dict[str, Any], prefix: str, counter: int) -> str:
            raw = str(issue.get("temp_id") or issue.get("tempId") or "").strip()
            return raw or f"{prefix}-{counter}"

        for issue in issues:
            if not isinstance(issue, dict):
                continue

            issue_type = str(issue.get("type") or "story").strip().lower()
            summary = str(issue.get("summary") or "").strip()
            description = str(issue.get("description") or "").strip()
            assignee = issue.get("assignee")
            acceptance = issue.get("acceptance_criteria") or issue.get("acceptanceCriteria") or []
            if not isinstance(acceptance, list):
                acceptance = [str(acceptance)] if str(acceptance).strip() else []
            priority = str(issue.get("priority") or "medium").lower()
            if priority not in {"high", "medium", "low"}:
                priority = "medium"

            if issue_type == "epic":
                epic_count += 1
                lane_index = _lane_index(issue, epic_count - 1)
                epics.append({
                    "tempId": f"epic-{epic_count}",
                    "planningPathIndex": lane_index,
                    "planningPathId": str(issue.get("planning_path_id") or "").strip(),
                    "title": summary or f"Epic {epic_count}",
                    "description": description,
                    "type": "epic",
                    "module": module_name,
                    "priority": priority,
                    "assignee": assignee,
                    "acceptanceCriteria": [str(x).strip() for x in acceptance if str(x).strip()],
                })
                continue

            if issue_type == "task":
                task_count += 1
                lane_index = _lane_index(issue, task_lane_cursor % selected_path_count)
                task_lane_cursor += 1
                epic_temp_id = f"epic-{max(1, lane_index + 1)}"
                task_temp_id = _temp_id(issue, "task", task_count)
                lane_parent_map[lane_index] = task_temp_id
                tasks.append({
                    "tempId": task_temp_id,
                    "epicTempId": epic_temp_id,
                    "planningPathIndex": lane_index,
                    "planningPathId": str(issue.get("planning_path_id") or "").strip(),
                    "title": summary or f"Task {task_count}",
                    "description": description,
                    "type": "task",
                    "module": module_name,
                    "priority": priority,
                    "assignee": assignee,
                    "acceptanceCriteria": [str(x).strip() for x in acceptance if str(x).strip()],
                })
                continue

            if issue_type == "subtask":
                subtask_count += 1
                parent_temp_id = str(issue.get("parent_temp_id") or issue.get("parentTempId") or "").strip()
                lane_index = _lane_index(issue, subtask_lane_cursor % selected_path_count)
                subtask_lane_cursor += 1
                epic_temp_id = f"epic-{max(1, lane_index + 1)}"
                subtasks.append({
                    "tempId": _temp_id(issue, "subtask", subtask_count),
                    "epicTempId": epic_temp_id,
                    "parentTempId": parent_temp_id,
                    "planningPathIndex": lane_index,
                    "planningPathId": str(issue.get("planning_path_id") or "").strip(),
                    "title": summary or f"Subtask {subtask_count}",
                    "description": description,
                    "type": "subtask",
                    "module": module_name,
                    "priority": priority,
                    "assignee": assignee,
                    "acceptanceCriteria": [str(x).strip() for x in acceptance if str(x).strip()],
                })
                continue

            story_count += 1
            lane_index = _lane_index(issue, story_lane_cursor % selected_path_count)
            story_lane_cursor += 1
            epic_temp_id = f"epic-{max(1, lane_index + 1)}"
            story_temp_id = _temp_id(issue, "story", story_count)
            lane_parent_map[lane_index] = story_temp_id
            stories.append({
                "tempId": story_temp_id,
                "epicTempId": epic_temp_id,
                "planningPathIndex": lane_index,
                "planningPathId": str(issue.get("planning_path_id") or "").strip(),
                "title": summary or f"Story {story_count}",
                "description": description,
                "type": "story",
                "module": module_name,
                "priority": priority,
                "assignee": assignee,
                "acceptanceCriteria": [str(x).strip() for x in acceptance if str(x).strip()],
            })

        return {
            "epics": epics,
            "stories": stories,
            "tasks": tasks,
            "subtasks": subtasks,
        }

    def _normalize_generated_backlog(self, result: Dict[str, Any], module_name: str, team_members_json: str = "[]", selected_paths_json: str = "[]") -> Dict[str, Any]:
        epics = result.get("epics") if isinstance(result, dict) else []
        stories = result.get("stories") if isinstance(result, dict) else []
        tasks = result.get("tasks") if isinstance(result, dict) else []
        subtasks = result.get("subtasks") if isinstance(result, dict) else []

        if not isinstance(epics, list):
            epics = []
        if not isinstance(stories, list):
            stories = []
        if not isinstance(tasks, list):
            tasks = []
        if not isinstance(subtasks, list):
            subtasks = []

        def _priority(v: str) -> str:
            val = str(v or "").lower()
            return val if val in {"high", "medium", "low"} else "medium"

        try:
            team_members = json.loads(team_members_json or "[]")
        except Exception:
            team_members = []
        if not isinstance(team_members, list):
            team_members = []

        team_lookup = {}
        team_ids = []
        for member in team_members:
            if not isinstance(member, dict):
                continue
            member_id = str(member.get("id") or "").strip()
            if not member_id:
                continue
            team_ids.append(member_id)
            for key in ("id", "name", "email", "jiraEmail", "role"):
                value = str(member.get(key) or "").strip().lower()
                if value:
                    team_lookup[value] = member_id

        assignee_index = 0
        try:
            selected_paths = json.loads(selected_paths_json or "[]")
        except Exception:
            selected_paths = []
        if not isinstance(selected_paths, list):
            selected_paths = []

        path_count = max(1, len(selected_paths))

        def _assignee(value: Any, idx: int) -> Any:
            nonlocal assignee_index
            if team_ids:
                assigned = team_ids[assignee_index % len(team_ids)]
                assignee_index += 1
                return assigned
            return None

        def _normalize_item(item: Dict[str, Any], item_type: str, parent_id: str = None, idx: int = 0) -> Dict[str, Any]:
            temp_id = str(item.get("tempId") or f"{item_type}-{idx + 1}")
            title = str(item.get("title") or "").strip() or f"{item_type.title()} {idx + 1}"
            return {
                **item,
                "tempId": temp_id,
                "title": title,
                "description": str(item.get("description") or "").strip(),
                "type": item_type,
                "module": str(item.get("module") or module_name or "core").strip(),
                "priority": _priority(item.get("priority")),
                "assignee": _assignee(item.get("assignee"), idx),
                "status": "todo",
                "startDate": item.get("startDate") if item.get("startDate") else None,
                "dueDate": item.get("dueDate") if item.get("dueDate") else None,
                "storyPoints": _safe_int(item.get("storyPoints"), 0),
                "parentId": parent_id,
            }

        normalized_epics = [_normalize_item(e if isinstance(e, dict) else {}, "epic", None, i) for i, e in enumerate(epics)]

        epic_ids = {e["tempId"] for e in normalized_epics}
        normalized_stories = []
        for i, s in enumerate(stories):
            if not isinstance(s, dict):
                continue
            epic_temp = str(s.get("epicTempId") or s.get("parentId") or "")
            if epic_temp not in epic_ids:
                lane_index = _safe_int(s.get("planningPathIndex"), 0)
                if normalized_epics:
                    epic_temp = normalized_epics[max(0, min(lane_index, len(normalized_epics) - 1))]["tempId"]
                else:
                    epic_temp = None
            if epic_temp not in epic_ids:
                raise ValueError(f"Generated story '{s.get('title') or s.get('tempId') or i}' references missing epicTempId")
            item = _normalize_item(s, "story", epic_temp, i)
            item["epicTempId"] = epic_temp
            item["planningPathIndex"] = _safe_int(s.get("planningPathIndex"), 0)
            item["planningPathId"] = s.get("planningPathId") or ""
            item["acceptanceCriteria"] = s.get("acceptanceCriteria") or []
            normalized_stories.append(item)

        story_ids = {s["tempId"] for s in normalized_stories}
        normalized_tasks = []
        for i, t in enumerate(tasks):
            if not isinstance(t, dict):
                continue
            epic_temp = str(t.get("epicTempId") or "")
            if epic_temp not in epic_ids:
                lane_index = _safe_int(t.get("planningPathIndex"), 0)
                if normalized_epics:
                    epic_temp = normalized_epics[max(0, min(lane_index, len(normalized_epics) - 1))]["tempId"]
                else:
                    epic_temp = None
            if epic_temp not in epic_ids:
                raise ValueError(f"Generated task '{t.get('title') or t.get('tempId') or i}' references missing epicTempId")
            item = _normalize_item(t, "task", None, i)
            item["epicTempId"] = epic_temp
            item["planningPathIndex"] = _safe_int(t.get("planningPathIndex"), 0)
            item["planningPathId"] = t.get("planningPathId") or ""
            item["acceptanceCriteria"] = t.get("acceptanceCriteria") or []
            normalized_tasks.append(item)

        task_ids = {t["tempId"] for t in normalized_tasks}
        normalized_subtasks = []
        for i, st in enumerate(subtasks):
            if not isinstance(st, dict):
                continue
            parent_task = str(st.get("parentTempId") or st.get("parentId") or "").strip()
            if parent_task not in story_ids and parent_task not in task_ids:
                raise ValueError(f"Generated subtask '{st.get('title') or st.get('tempId') or i}' references missing parentTempId")
            epic_temp = str(st.get("epicTempId") or "")
            if epic_temp not in epic_ids:
                lane_index = _safe_int(st.get("planningPathIndex"), 0)
                if normalized_epics:
                    epic_temp = normalized_epics[max(0, min(lane_index, len(normalized_epics) - 1))]["tempId"]
                else:
                    epic_temp = None
            if epic_temp not in epic_ids:
                raise ValueError(f"Generated subtask '{st.get('title') or st.get('tempId') or i}' references missing epicTempId")
            item = _normalize_item(st, "subtask", parent_task, i)
            item["parentTempId"] = parent_task
            item["epicTempId"] = epic_temp
            item["planningPathIndex"] = _safe_int(st.get("planningPathIndex"), 0)
            item["planningPathId"] = st.get("planningPathId") or ""
            item["acceptanceCriteria"] = st.get("acceptanceCriteria") or []
            normalized_subtasks.append(item)

        if not normalized_stories:
            raise ValueError("Generated backlog must include stories linked to epics")
        if not normalized_tasks:
            raise ValueError("Generated backlog must include tasks linked to stories")
        if not normalized_epics:
            raise ValueError("Generated backlog must include at least one epic")

        return {
            "epics": normalized_epics,
            "stories": normalized_stories,
            "tasks": normalized_tasks,
            "subtasks": normalized_subtasks,
        }

    def _validate_backlog_distribution(self, normalized: Dict[str, Any], selected_paths_json: str = "[]") -> None:
        try:
            selected_paths = json.loads(selected_paths_json or "[]")
        except Exception:
            selected_paths = []

        if not isinstance(selected_paths, list):
            selected_paths = []

        path_count = max(1, len(selected_paths))
        epics = normalized.get("epics") if isinstance(normalized, dict) else []
        stories = normalized.get("stories") if isinstance(normalized, dict) else []
        tasks = normalized.get("tasks") if isinstance(normalized, dict) else []
        subtasks = normalized.get("subtasks") if isinstance(normalized, dict) else []

        if len(epics) < path_count:
            raise ValueError(f"Generated backlog must include at least one epic per selected path (expected {path_count}, got {len(epics)})")
        if not stories:
            raise ValueError("Generated backlog must include at least one story")
        if not tasks:
            raise ValueError("Generated backlog must include at least one task")

        story_ids = {str(item.get("tempId") or "").strip() for item in stories if isinstance(item, dict)}
        task_ids = {str(item.get("tempId") or "").strip() for item in tasks if isinstance(item, dict)}

        child_counts = {parent_id: 0 for parent_id in story_ids.union(task_ids)}
        for subtask in subtasks:
            if not isinstance(subtask, dict):
                continue
            parent_id = str(subtask.get("parentTempId") or "").strip()
            if parent_id in child_counts:
                child_counts[parent_id] += 1

    def validate_code_against_story(
        self,
        story_title: str,
        acceptance_criteria: List[str],
        code_diff: str,
        commit_message: str,
        ai_config: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        criteria_text = "\n".join(f"- {c}" for c in acceptance_criteria)

        prompt = CODE_ANALYSIS_PROMPT.format(
            story_title=story_title,
            acceptance_criteria=criteria_text,
            code_diff=code_diff[:3000],
            commit_message=commit_message,
        )

        raw = self._call_llm(prompt, temperature=0.1, ai_config=ai_config, operation="validate_code")
        raw = raw.strip()

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"status": "not_started", "reasoning": "Analysis failed", "evidence": []}

    def suggest_planner_prompts(self, project_name: str, module_name: str, user_input: str, context_graph: Dict[str, Any], ai_config: Dict[str, Any] = None) -> Dict[str, Any]:
        compact_graph = self._compact_context_graph_for_prompt(context_graph)
        requirement_map = {
            "project": project_name,
            "module": module_name,
            "requirements": compact_graph.get("documents", []),
        }
        prompt = PLANNER_SUGGEST_PROMPT.format(
            requirement_map_json=json.dumps(requirement_map, separators=(",", ":")),
            project_state_json=json.dumps(context_graph or {}, separators=(",", ":")),
            module_name=module_name,
            user_input=user_input or "",
        )

        try:
            raw = self._call_llm(prompt, temperature=0.2, ai_config=ai_config, operation="suggest_planner").strip()
        except Exception as err:
            if not self._is_context_overflow_error(err):
                logger.warning("suggest_planner_prompts failed before parse (non-overflow): %s", str(err))
                raise RuntimeError(f"LLM call failed: {str(err)}")

            # Retry once with an aggressively compacted context for smaller local models.
            logger.warning("suggest_planner_prompts context overflow, retrying with compact graph")
            retry_graph = self._compact_context_graph_for_prompt(
                context_graph,
                max_json_chars=3200,
                doc_snippet_chars=700,
                max_docs=1,
            )
            retry_prompt = PLANNER_SUGGEST_PROMPT.format(
                requirement_map_json=json.dumps(requirement_map, separators=(",", ":")),
                project_state_json=json.dumps(retry_graph, separators=(",", ":")),
                module_name=module_name,
                user_input=user_input or "",
            )
            try:
                raw = self._call_llm(retry_prompt, temperature=0.2, ai_config=ai_config, operation="suggest_planner").strip()
            except Exception as retry_err:
                logger.warning("suggest_planner_prompts retry failed: %s", str(retry_err))
                raise RuntimeError(f"LLM call failed after compact retry: {str(retry_err)}")

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            parsed = json.loads(raw)
            paths = parsed.get("paths", [])
            if not isinstance(paths, list):
                raise ValueError("LLM returned JSON with invalid planning path keys")

            normalized = []
            for idx, path in enumerate(paths):
                if not isinstance(path, dict):
                    continue
                reqs = path.get("requirements") or path.get("requirement_ids") or []
                if not isinstance(reqs, list):
                    reqs = [reqs]
                normalized.append({
                    "id": str(path.get("id") or f"path-{idx + 1}").strip(),
                    "name": str(path.get("name") or f"Path {idx + 1}").strip(),
                    "reason": str(path.get("reason") or "").strip(),
                    "requirements": [str(r).strip().upper() for r in reqs if str(r).strip()],
                    "priority": str(path.get("priority") or "medium").strip().lower(),
                    "dependency_notes": str(path.get("dependency_notes") or "").strip(),
                })

            if not normalized:
                raise ValueError("LLM returned no planning paths")

            return {
                "paths": normalized[:7],
                "meta": parsed.get("meta", {}) if isinstance(parsed, dict) else {},
            }
        except Exception as parse_err:
            logger.warning("suggest_planner_prompts JSON parse failed: %s | raw_head=%s", str(parse_err), raw[:240])
            raise ValueError("LLM returned invalid JSON for suggest response")

    def extract_requirements(self, text: str, ai_config: Dict[str, Any] = None) -> Dict[str, List[str]]:
        prompt = REQUIREMENT_EXTRACTION_PROMPT.format(
            srs_text=self._trim_text(text, 32000),
        )

        raw = self._call_llm(prompt, temperature=0.1, ai_config=ai_config, operation="extract_requirements").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            parsed = json.loads(raw)
        except Exception as parse_err:
            logger.warning("extract_requirements JSON parse failed: %s | raw_head=%s", str(parse_err), raw[:280])
            raise ValueError("LLM returned invalid JSON for requirement extraction")

        return {
            "functional_requirements": [str(x).strip() for x in (parsed.get("functional_requirements") or []) if str(x).strip()][:40],
            "non_functional_requirements": [str(x).strip() for x in (parsed.get("non_functional_requirements") or []) if str(x).strip()][:30],
            "modules": [str(x).strip() for x in (parsed.get("modules") or []) if str(x).strip()][:20],
            "actors": [str(x).strip() for x in (parsed.get("actors") or []) if str(x).strip()][:20],
        }

    def extract_target_requirement_ids(
        self,
        module_name: str,
        user_input: str,
        requirement_map_json: str,
        project_state_json: str,
        completed_jira_ids_json: str = "[]",
        ai_config: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        prompt = DISCOVERY_GAPS_PROMPT.format(
            requirement_map_json=self._trim_text(requirement_map_json or "{}", 18000),
            project_state_json=self._trim_text(project_state_json or "{}", 18000),
            completed_jira_ids_json=self._trim_text(completed_jira_ids_json or "[]", 12000),
            module_name=module_name,
            user_input=user_input or "",
        )

        raw = self._call_llm(prompt, temperature=0.1, ai_config=ai_config, operation="discover_gaps").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            parsed = json.loads(raw)
            paths = parsed.get("paths") if isinstance(parsed, dict) else []
            if not isinstance(paths, list):
                raise ValueError("Invalid paths format")

            normalized_paths = []
            requirement_ids = []
            seen = set()
            for idx, path in enumerate(paths):
                if not isinstance(path, dict):
                    continue
                reqs = path.get("requirements") or path.get("requirement_ids") or []
                if not isinstance(reqs, list):
                    reqs = [reqs]
                normalized_reqs = []
                for rid in reqs:
                    val = str(rid or "").strip().upper()
                    if not val:
                        continue
                    normalized_reqs.append(val)
                    if val not in seen:
                        seen.add(val)
                        requirement_ids.append(val)
                normalized_paths.append({
                    "id": str(path.get("id") or f"path-{idx + 1}").strip(),
                    "name": str(path.get("name") or f"Path {idx + 1}").strip(),
                    "reason": str(path.get("reason") or "").strip(),
                    "requirements": normalized_reqs,
                    "priority": str(path.get("priority") or "medium").strip().lower(),
                    "dependency_notes": str(path.get("dependency_notes") or "").strip(),
                })
            return {
                "paths": normalized_paths[:7],
                "requirement_ids": requirement_ids[:12],
                "meta": parsed.get("meta", {}) if isinstance(parsed, dict) else {},
            }
        except Exception as parse_err:
            logger.warning("extract_target_requirement_ids JSON parse failed: %s | raw_head=%s", str(parse_err), raw[:260])
            raise ValueError("LLM returned invalid JSON for requirement ID discovery")

    def suggest_phase_actions(
        self,
        project_name: str,
        module_name: str,
        phase: str,
        user_input: str,
        modules: List[str],
        functional_requirements: List[str],
        non_functional_requirements: List[str],
        actors: List[str],
        existing_work: List[Dict[str, Any]],
        fetched_chunks: List[str] = None,
        project_state: Dict[str, Any] = None,
        ai_config: Dict[str, Any] = None,
    ) -> List[Dict[str, str]]:
        srs_lines = fetched_chunks or []
        if not srs_lines:
            srs_lines = [
                f"Project: {project_name}",
                f"Module Focus: {module_name}",
                f"Phase: {phase}",
                "Modules:",
                *[f"- {m}" for m in (modules or [])[:20]],
                "Functional Requirements:",
                *[f"- {fr}" for fr in (functional_requirements or [])[:40]],
                "Non-Functional Requirements:",
                *[f"- {nfr}" for nfr in (non_functional_requirements or [])[:30]],
                "Actors:",
                *[f"- {actor}" for actor in (actors or [])[:20]],
            ]
        full_srs_text = "\n".join(srs_lines)
        project_state_payload = project_state if isinstance(project_state, dict) else {"existing_work": existing_work[:120]}

        prompt = PHASE_ACTION_SUGGEST_PROMPT.format(
            fetched_srs_chunks=self._trim_text(full_srs_text, 14000),
            project_state_json=self._trim_text(json.dumps(project_state_payload, ensure_ascii=False), 9000),
            user_custom_instruction=user_input or "",
        )

        raw = self._call_llm(prompt, temperature=0.2, ai_config=ai_config, operation="suggest_phase_actions").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            parsed = json.loads(raw)
        except Exception as parse_err:
            logger.warning("suggest_phase_actions JSON parse failed: %s | raw_head=%s", str(parse_err), raw[:280])
            raise ValueError("LLM returned invalid JSON for phase-aware suggestions")

        suggestions = parsed.get("suggestions") if isinstance(parsed, dict) else None
        if not isinstance(suggestions, list):
            raise ValueError("LLM returned invalid JSON for gap-analysis suggestions")

        normalized = []
        module_catalog = [str(m).strip().lower() for m in (modules or []) if str(m).strip()]
        seen_keys = set()

        for idx, item in enumerate(suggestions):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "")).strip()
            description = str(item.get("description", "")).strip()
            logic = str(item.get("logic", "")).strip()
            impact = str(item.get("impact", "medium")).strip().lower()
            effort = str(item.get("estimated_effort", "medium")).strip().lower()

            raw_type = str(item.get("type", "")).strip().lower()
            type_alias = {
                "epic": "epic",
                "story": "story",
                "task": "task",
                "subtask": "subtask",
                "sub-task": "subtask",
                "integration": "epic",
                "improvement": "task",
                "feature": "story",
            }
            action_type = type_alias.get(raw_type)
            if not action_type:
                if impact == "high" and ("integration" in title.lower() or "api" in title.lower()):
                    action_type = "epic"
                elif impact == "low":
                    action_type = "task"
                else:
                    action_type = "story"

            priority = "high" if impact == "high" else ("low" if impact == "low" else "medium")
            module = str(item.get("module", module_name)).strip()
            reason = logic or description or f"Gap-analysis suggestion {idx + 1} (effort: {effort or 'medium'})."

            if not title:
                continue

            title_low = title.lower()
            if action_type not in {"epic", "story", "task", "subtask"}:
                action_type = "story"
            if priority not in {"high", "medium", "low"}:
                priority = "medium"

            module_low = module.lower()
            if module_catalog and module_low not in module_catalog:
                matched = next((m for m in module_catalog if m in title_low), None)
                module = matched if matched else modules[0]

            dedupe_key = f"{module.lower()}|{title_low}"
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)

            normalized.append({
                "title": title,
                "type": action_type,
                "priority": priority,
                "module": module,
                "reason": reason,
                "description": description,
                "impact": impact,
                "estimated_effort": effort,
            })

        if len(normalized) < 3:
            raise ValueError("Insufficient structured suggestions generated")

        return normalized[:7]

    def summarize_jira_project(self, project_key: str, issues: List[Dict[str, Any]], ai_config: Dict[str, Any] = None) -> Dict[str, Any]:
        issues_text = "\n".join(
            f"- {i.get('key', 'N/A')} | {i.get('type', 'Unknown')} | {i.get('status', 'Unknown')} | {i.get('priority', 'Unknown')} | {i.get('summary', '')}"
            for i in issues[:120]
        ) or "No issues provided"

        prompt = JIRA_SUMMARY_PROMPT.format(project_key=project_key, issues_text=issues_text)
        raw = self._call_llm(prompt, temperature=0.2, ai_config=ai_config, operation="summarize_jira").strip()

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            result = json.loads(raw)
            return {
                "summary": result.get("summary", ""),
                "topRisks": result.get("topRisks", []),
                "nextActions": result.get("nextActions", []),
            }
        except Exception:
            return {
                "summary": "Unable to generate AI Jira summary.",
                "topRisks": [],
                "nextActions": [],
            }

    def summarize_standup(self, context: str, ai_config: Dict[str, Any] = None) -> str:
        prompt = STANDUP_SUMMARY_PROMPT.format(context=self._trim_text(context, 16000))
        return self._call_llm(prompt, temperature=0.2, ai_config=ai_config, operation="standup_summary").strip()
