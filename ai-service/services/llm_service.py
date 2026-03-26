import os
import json
import re
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


STORY_GENERATION_PROMPT = """You are a senior software architect generating a production-ready Jira backlog.

Project: {project_name}
Module Focus: {module_name}
{constraints}

Context from SRS document:
{context}

Additional context:
{additional_context}

Instructions:
1. Generate a COMPLETE backlog hierarchy: Epics -> Stories -> Tasks -> Subtasks.
2. Focus ONLY on domain-specific features from SRS context.
3. DO NOT include generic tasks: optimize, refactor, improve, enhance, validation.
4. Ensure logical engineering dependency flow and no orphan items.
5. Minimum 2 epics; each epic must have at least 1 story; each story must have at least 1 task.
6. Return STRICT JSON only using this structure and fields.

Return ONLY valid JSON with exact shape:
{{
    "epics": [
        {{
            "tempId": "epic-1",
            "title": "",
            "description": "",
            "type": "epic",
            "module": "",
            "priority": "high|medium|low",
            "assignee": null,
            "status": "todo",
            "startDate": null,
            "dueDate": null,
            "storyPoints": 0,
            "parentId": null,
            "sprint": "S1"
        }}
    ],
    "stories": [
        {{
            "tempId": "story-1",
            "epicTempId": "epic-1",
            "title": "",
            "description": "",
            "type": "story",
            "module": "",
            "priority": "high|medium|low",
            "assignee": null,
            "status": "todo",
            "startDate": null,
            "dueDate": null,
            "storyPoints": 0,
            "parentId": "epic-1",
            "acceptanceCriteria": ["", ""],
            "sprint": "S1"
        }}
    ],
    "tasks": [
        {{
            "tempId": "task-1",
            "epicTempId": "epic-1",
            "parentTempId": "story-1",
            "title": "",
            "description": "",
            "type": "task",
            "module": "",
            "priority": "high|medium|low",
            "assignee": null,
            "status": "todo",
            "startDate": null,
            "dueDate": null,
            "storyPoints": 0,
            "parentId": "story-1",
            "acceptanceCriteria": [""],
            "sprint": "S1"
        }}
    ],
    "subtasks": [
        {{
            "tempId": "subtask-1",
            "epicTempId": "epic-1",
            "parentTempId": "task-1",
            "title": "",
            "description": "",
            "type": "subtask",
            "module": "",
            "priority": "high|medium|low",
            "assignee": null,
            "status": "todo",
            "startDate": null,
            "dueDate": null,
            "storyPoints": 0,
            "parentId": "task-1",
            "acceptanceCriteria": [""],
            "sprint": "S1"
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


PLANNER_SUGGEST_PROMPT = """You are an Agile planning copilot for a project that may be at very early stage.

Project: {project_name}
Module: {module_name}
User Input: {user_input}

Vectorless context graph JSON:
{context_graph}

Task:
Generate practical NEXT planning suggestions grounded ONLY in the provided context.

Personalization requirements:
- Use concrete domain terms, entities, and workflows that appear in the provided context graph snippets.
- Include requirement identifiers when present (for example FR-1, FR-2, NFR-1) and reference them naturally.
- Mention at least one specific business noun from the SRS in every suggestion (for example Patient, Appointment, Invoice, Course, Shipment, Claim) when present in context.
- Avoid generic filler like "core functionality", "initial MVP", "define acceptance criteria", unless paired with concrete SRS-specific details.
- If context provides explicit fields/states/roles/integrations, reflect those details directly in suggestions.

Critical behavior:
- If context indicates startup/initiation state (for example source=srs_only, no jira/commit progress), produce startup suggestions first.
- Startup suggestions should focus on: MVP slicing from SRS, first epic/story breakdown, dependency/risk spikes only if present in SRS, and clear acceptance criteria setup.
- Do NOT produce mid-project/maintenance suggestions (refactor technical debt, performance tuning, phase-2 module planning) unless explicitly supported by the context.
- Do NOT invent domains/integrations (FHIR, WebRTC, payments, mobile, etc.) unless present in SRS/context.
- Prefer requirement-grounded wording. If SRS has requirement IDs (FR-*, NFR-*), reference them naturally.

Return ONLY valid JSON:
{{
    "epics": [
        "Epic-level planning suggestion 1",
        "Epic-level planning suggestion 2"
    ],
    "stories": [
        "Story-level planning suggestion 1",
        "Story-level planning suggestion 2"
    ],
    "tasks": [
        "Task-level planning suggestion 1",
        "Task-level planning suggestion 2"
    ]
}}

Output rules:
- 2 to 4 epics, 4 to 8 stories, 4 to 8 tasks
- Each entry must be one sentence, 10-24 words, begin with an action verb
- Keep suggestions backlog/planning oriented and immediately actionable
- Ensure each suggestion is distinct and targets a different planning action (scope, workflow, data model, role permissions, integrations, NFRs, risks, validation).
- No markdown, no extra keys, JSON only
"""


REQUIREMENT_EXTRACTION_PROMPT = """Extract structured requirements from the following SRS.

Return ONLY valid JSON with this shape:
{{
    "functional_requirements": ["..."],
    "non_functional_requirements": ["..."],
    "modules": ["..."],
    "actors": ["..."]
}}

Rules:
- Keep requirements concise and deduplicated
- Preserve requirement IDs like FR-1 / NFR-2 if present
- Do not invent modules or actors

SRS:
{srs_text}
"""


PHASE_ACTION_SUGGEST_PROMPT = """You are an AI software planning assistant.

Project: {project_name}
Module Focus: {module_name}
Project Phase: {phase}
User Input: {user_input}

Modules:
{modules}

Functional Requirements:
{functional_requirements}

Non-Functional Requirements:
{non_functional_requirements}

Actors:
{actors}

Existing Work:
{existing_work}

Task:
Suggest 5 to 7 high-value development actions.

Rules:
- You MUST prioritize features directly derived from the SRS domain and listed modules/requirements.
- If domain terms imply healthcare, prioritize appointment, doctor, patient, scheduling flows first.
- Each suggestion MUST belong to a concrete module from the provided module list when available.
- Align with project phase:
    - START phase: suggest ONLY core product features and required integrations.
    - START phase: DO NOT suggest optimization/UI tweaks/refactors/improvements.
- Avoid duplicates and avoid generic planning language.
- DO NOT include titles containing these words: optimize, refactor, improve, enhance, validation, error handling, define, plan.
- Return at least 3 core features and at most 7 total suggestions.

Return ONLY valid JSON array:
[
    {{
        "title": "",
        "type": "feature | improvement | integration",
        "priority": "high | medium | low",
        "module": "",
        "reason": ""
    }}
]
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
        return OpenAI(
            api_key=api_key,
            base_url=base_url,
        )

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
    ) -> str:
        ctx_budget = 11000
        add_budget = 13000

        for _ in range(6):
            compact_context = self._compact_rag_context(context, ctx_budget, module_name)
            compact_additional = self._extract_vectorless_summary(additional_context, module_name, add_budget)

            prompt = STORY_GENERATION_PROMPT.format(
                project_name=project_name,
                module_name=module_name,
                context=compact_context or "No SRS document ingested yet.",
                additional_context=compact_additional or "None",
                constraints=constraints or "",
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
        return STORY_GENERATION_PROMPT.format(
            project_name=project_name,
            module_name=module_name,
            context=compact_context or "No SRS document ingested yet.",
            additional_context=compact_additional or "None",
            constraints=constraints or "",
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

    def _call_llm(self, prompt: str, temperature: float = 0.3, ai_config: Dict[str, Any] = None) -> str:
        cfg = ai_config or {}
        provider = cfg.get("provider") or "openrouter"
        resolved_temperature = float(cfg.get("temperature", temperature))
        resolved_max_tokens = int(cfg.get("maxTokens", self.max_tokens))

        if provider == "deepseek_local":
            deepseek_url = (cfg.get("deepseekUrl") or os.getenv("DEEPSEEK_LOCAL_URL") or "").strip()
            if not deepseek_url:
                raise ValueError("DeepSeek local provider selected but no URL configured")

            deepseek_model = cfg.get("deepseekModel") or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            client = self._get_deepseek_client(deepseek_url)
            response = client.chat.completions.create(
                model=deepseek_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=resolved_temperature,
                max_tokens=resolved_max_tokens,
            )
            return response.choices[0].message.content

        key_name = cfg.get("openrouterKeyName") or "OPENROUTER_API_KEY"
        api_key = os.getenv(key_name) or os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OpenRouter API key is not configured")

        client = self._get_openrouter_client(api_key)
        selected_model = cfg.get("openrouterModel") or self.model

        # Try selected model first, then fallbacks
        models_to_try = [selected_model] + [m for m in self.FREE_MODELS if m != selected_model]
        last_error = None
        for model in models_to_try:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=resolved_temperature,
                    max_tokens=resolved_max_tokens,
                )
                return response.choices[0].message.content
            except Exception as e:
                err = str(e)
                if '429' in err or '404' in err or 'rate' in err.lower() or 'not found' in err.lower():
                    last_error = e
                    continue  # try next model
                raise  # non-rate-limit error, re-raise immediately
        raise last_error

    def generate_stories(
        self,
        project_name: str,
        module_name: str,
        context: str,
        additional_context: str = "",
        constraints: str = "",
        ai_config: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        prompt = self._build_generate_prompt_with_budget(
            project_name=project_name,
            module_name=module_name,
            context=context or "",
            additional_context=additional_context or "",
            constraints=constraints or "",
        )

        raw = self._call_llm(prompt, temperature=0.4, ai_config=ai_config)

        # Parse JSON (handle markdown code blocks)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            # Attempt to extract JSON from response
            import re
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            if match:
                result = json.loads(match.group())
            else:
                raise ValueError(f"LLM returned invalid JSON: {raw[:200]}")

        return self._normalize_generated_backlog(result, module_name)

    def _normalize_generated_backlog(self, result: Dict[str, Any], module_name: str) -> Dict[str, Any]:
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
                "assignee": item.get("assignee") if item.get("assignee") else None,
                "status": "todo",
                "startDate": item.get("startDate") if item.get("startDate") else None,
                "dueDate": item.get("dueDate") if item.get("dueDate") else None,
                "storyPoints": int(item.get("storyPoints") or 0),
                "parentId": parent_id,
            }

        normalized_epics = [_normalize_item(e if isinstance(e, dict) else {}, "epic", None, i) for i, e in enumerate(epics)]
        if len(normalized_epics) < 2:
            raise ValueError("Generated backlog must include at least 2 epics")

        epic_ids = {e["tempId"] for e in normalized_epics}
        normalized_stories = []
        for i, s in enumerate(stories):
            if not isinstance(s, dict):
                continue
            epic_temp = str(s.get("epicTempId") or s.get("parentId") or "")
            if epic_temp not in epic_ids:
                epic_temp = normalized_epics[0]["tempId"]
            item = _normalize_item(s, "story", epic_temp, i)
            item["epicTempId"] = epic_temp
            item["acceptanceCriteria"] = s.get("acceptanceCriteria") or []
            normalized_stories.append(item)

        story_ids = {s["tempId"] for s in normalized_stories}
        normalized_tasks = []
        for i, t in enumerate(tasks):
            if not isinstance(t, dict):
                continue
            parent_story = str(t.get("parentTempId") or t.get("parentId") or "")
            if parent_story not in story_ids:
                parent_story = normalized_stories[0]["tempId"] if normalized_stories else None
            epic_temp = str(t.get("epicTempId") or "")
            if epic_temp not in epic_ids:
                epic_temp = normalized_epics[0]["tempId"]
            item = _normalize_item(t, "task", parent_story, i)
            item["parentTempId"] = parent_story
            item["epicTempId"] = epic_temp
            item["acceptanceCriteria"] = t.get("acceptanceCriteria") or []
            normalized_tasks.append(item)

        task_ids = {t["tempId"] for t in normalized_tasks}
        normalized_subtasks = []
        for i, st in enumerate(subtasks):
            if not isinstance(st, dict):
                continue
            parent_task = str(st.get("parentTempId") or st.get("parentId") or "")
            if parent_task not in task_ids:
                parent_task = normalized_tasks[0]["tempId"] if normalized_tasks else None
            epic_temp = str(st.get("epicTempId") or "")
            if epic_temp not in epic_ids:
                epic_temp = normalized_epics[0]["tempId"]
            item = _normalize_item(st, "subtask", parent_task, i)
            item["parentTempId"] = parent_task
            item["epicTempId"] = epic_temp
            item["acceptanceCriteria"] = st.get("acceptanceCriteria") or []
            normalized_subtasks.append(item)

        if not normalized_stories:
            raise ValueError("Generated backlog must include stories linked to epics")
        if not normalized_tasks:
            raise ValueError("Generated backlog must include tasks linked to stories")

        return {
            "epics": normalized_epics,
            "stories": normalized_stories,
            "tasks": normalized_tasks,
            "subtasks": normalized_subtasks,
        }

    def validate_code_against_story(
        self,
        story_title: str,
        acceptance_criteria: List[str],
        code_diff: str,
        commit_message: str,
    ) -> Dict[str, Any]:
        criteria_text = "\n".join(f"- {c}" for c in acceptance_criteria)

        prompt = CODE_ANALYSIS_PROMPT.format(
            story_title=story_title,
            acceptance_criteria=criteria_text,
            code_diff=code_diff[:3000],
            commit_message=commit_message,
        )

        raw = self._call_llm(prompt, temperature=0.1)
        raw = raw.strip()

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"status": "not_started", "reasoning": "Analysis failed", "evidence": []}

    def suggest_planner_prompts(self, project_name: str, module_name: str, user_input: str, context_graph: Dict[str, Any], ai_config: Dict[str, Any] = None) -> Dict[str, List[str]]:
        compact_graph = self._compact_context_graph_for_prompt(context_graph)
        prompt = PLANNER_SUGGEST_PROMPT.format(
            project_name=project_name,
            module_name=module_name,
            user_input=user_input or "",
            context_graph=json.dumps(compact_graph, separators=(",", ":")),
        )

        try:
            raw = self._call_llm(prompt, temperature=0.2, ai_config=ai_config).strip()
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
                project_name=project_name,
                module_name=module_name,
                user_input=user_input or "",
                context_graph=json.dumps(retry_graph, separators=(",", ":")),
            )
            try:
                raw = self._call_llm(retry_prompt, temperature=0.2, ai_config=ai_config).strip()
            except Exception as retry_err:
                logger.warning("suggest_planner_prompts retry failed: %s", str(retry_err))
                raise RuntimeError(f"LLM call failed after compact retry: {str(retry_err)}")

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            parsed = json.loads(raw)
            epics = parsed.get("epics", [])
            stories = parsed.get("stories", [])
            tasks = parsed.get("tasks", [])

            # Backward compatibility with older prompt responses.
            if not (isinstance(epics, list) and isinstance(stories, list) and isinstance(tasks, list)):
                legacy = parsed.get("suggestions", [])
                if isinstance(legacy, list):
                    logger.info("suggest_planner_prompts using legacy suggestions array format")
                    return {
                        "epics": [str(s).strip() for s in legacy[:2] if str(s).strip()],
                        "stories": [str(s).strip() for s in legacy[2:6] if str(s).strip()],
                        "tasks": [str(s).strip() for s in legacy[6:10] if str(s).strip()],
                    }
                logger.warning("suggest_planner_prompts parsed JSON but keys were invalid")
                raise ValueError("LLM returned JSON with invalid suggestion keys")

            return {
                "epics": [str(s).strip() for s in epics if str(s).strip()][:4],
                "stories": [str(s).strip() for s in stories if str(s).strip()][:8],
                "tasks": [str(s).strip() for s in tasks if str(s).strip()][:8],
            }
        except Exception as parse_err:
            logger.warning("suggest_planner_prompts JSON parse failed: %s | raw_head=%s", str(parse_err), raw[:240])
            raise ValueError("LLM returned invalid JSON for suggest response")

    def extract_requirements(self, text: str, ai_config: Dict[str, Any] = None) -> Dict[str, List[str]]:
        prompt = REQUIREMENT_EXTRACTION_PROMPT.format(
            srs_text=self._trim_text(text, 32000),
        )

        raw = self._call_llm(prompt, temperature=0.1, ai_config=ai_config).strip()
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
        ai_config: Dict[str, Any] = None,
    ) -> List[Dict[str, str]]:
        prompt = PHASE_ACTION_SUGGEST_PROMPT.format(
            project_name=project_name,
            module_name=module_name,
            phase=phase,
            user_input=user_input or "",
            modules=json.dumps(modules[:20], ensure_ascii=False),
            functional_requirements=json.dumps(functional_requirements[:40], ensure_ascii=False),
            non_functional_requirements=json.dumps(non_functional_requirements[:30], ensure_ascii=False),
            actors=json.dumps(actors[:20], ensure_ascii=False),
            existing_work=json.dumps(existing_work[:12], ensure_ascii=False),
        )

        raw = self._call_llm(prompt, temperature=0.2, ai_config=ai_config).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            parsed = json.loads(raw)
        except Exception as parse_err:
            logger.warning("suggest_phase_actions JSON parse failed: %s | raw_head=%s", str(parse_err), raw[:280])
            raise ValueError("LLM returned invalid JSON for phase-aware suggestions")

        if not isinstance(parsed, list):
            raise ValueError("LLM returned non-array response for phase-aware suggestions")

        normalized = []
        module_catalog = [str(m).strip().lower() for m in (modules or []) if str(m).strip()]
        banned_words = [
            "optimize", "refactor", "improve", "enhance",
            "validation", "error handling", "define", "plan",
        ]
        seen_keys = set()

        for item in parsed:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "")).strip()
            action_type = str(item.get("type", "feature")).strip().lower()
            priority = str(item.get("priority", "medium")).strip().lower()
            module = str(item.get("module", module_name)).strip()
            reason = str(item.get("reason", "")).strip()

            if not title:
                continue

            title_low = title.lower()
            if any(word in title_low for word in banned_words):
                continue

            if action_type not in {"feature", "improvement", "integration"}:
                action_type = "feature"
            if priority not in {"high", "medium", "low"}:
                priority = "medium"

            if phase == "start" and action_type == "improvement":
                continue

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
            })

        if phase == "start":
            core = [x for x in normalized if x["type"] in {"feature", "integration"}]
            if len(core) < 3:
                raise ValueError("Insufficient core feature suggestions for START phase")
            return core[:7]

        return normalized[:7]

    def summarize_jira_project(self, project_key: str, issues: List[Dict[str, Any]]) -> Dict[str, Any]:
        issues_text = "\n".join(
            f"- {i.get('key', 'N/A')} | {i.get('type', 'Unknown')} | {i.get('status', 'Unknown')} | {i.get('priority', 'Unknown')} | {i.get('summary', '')}"
            for i in issues[:120]
        ) or "No issues provided"

        prompt = JIRA_SUMMARY_PROMPT.format(project_key=project_key, issues_text=issues_text)
        raw = self._call_llm(prompt, temperature=0.2).strip()

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
