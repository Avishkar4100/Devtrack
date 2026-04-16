# pyright: reportMissingImports=false

from __future__ import annotations

import json
import os
import re
import textwrap
from datetime import datetime
from typing import Any, Dict, List

import requests
import streamlit as st
import streamlit.components.v1 as components


def _fmt_time(ts: float | int | None) -> str:
    if not ts:
        return "-"
    try:
        return datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "-"


def _api_url() -> str:
    return st.session_state.get("ai_service_url", os.getenv("AI_SERVICE_URL", "http://localhost:8000")).rstrip("/")


def _is_network_issue(exc: Exception) -> bool:
    return isinstance(
        exc,
        (
            requests.exceptions.Timeout,
            requests.exceptions.ConnectionError,
            requests.exceptions.ReadTimeout,
        ),
    )


def _fetch(path: str, method: str = "GET", body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    url = f"{_api_url()}{path}"
    timeout = 12
    if method == "GET":
        res = requests.get(url, timeout=timeout)
    else:
        res = requests.post(url, json=body or {}, timeout=timeout)
    res.raise_for_status()
    return res.json()


def _load_pending() -> List[Dict[str, Any]]:
    payload = _fetch("/manual-bridge/requests?status=pending&limit=200")
    return payload.get("data") or []


def _load_recent() -> List[Dict[str, Any]]:
    payload = _fetch("/manual-bridge/requests?limit=40")
    return payload.get("data") or []


def _extract_requirement_ids(text: str) -> List[str]:
        pattern = re.compile(r"\b(?:FR|NFR)(?:-[A-Z0-9]+)*-\d{1,4}\b", re.IGNORECASE)
        seen = set()
        ordered: List[str] = []
        for match in pattern.finditer(text or ""):
                req_id = match.group(0).upper()
                if req_id in seen:
                        continue
                seen.add(req_id)
                ordered.append(req_id)
        return ordered


def _fetch_target_chunks(project_id: str, requirement_ids: List[str], top_k_per_id: int) -> List[str]:
        payload = _fetch(
                "/stories/chunks-by-ids",
                method="POST",
                body={
                        "project_id": project_id,
                        "requirement_ids": requirement_ids,
                        "top_k_per_id": top_k_per_id,
                },
        )
        rows = payload.get("chunks")
        if isinstance(rows, list):
                return [str(row) for row in rows if str(row).strip()]
        return []


def _render_copy_button(text: str, key: str, label: str = "Copy") -> None:
        escaped = json.dumps(text or "")
        components.html(
                f"""
                <button
                    id="copy_{key}"
                    style="
                        border: 1px solid #4b5563;
                        border-radius: 6px;
                        background: #111827;
                        color: #e5e7eb;
                        padding: 6px 10px;
                        cursor: pointer;
                        font-size: 12px;
                    "
                >{label}</button>
                <span id="status_{key}" style="margin-left:8px;color:#9ca3af;font-size:12px;"></span>
                <script>
                    const btn = document.getElementById("copy_{key}");
                    const status = document.getElementById("status_{key}");
                    btn.onclick = async () => {{
                        try {{
                            await navigator.clipboard.writeText({escaped});
                            status.textContent = "Copied";
                        }} catch (err) {{
                            status.textContent = "Copy failed";
                        }}
                    }};
                </script>
                """,
                height=36,
        )


def _resolve(request_id: str, response_text: str) -> None:
    _fetch(f"/manual-bridge/requests/{request_id}/resolve", method="POST", body={"responseText": response_text})


def _reject(request_id: str, error_text: str) -> None:
    _fetch(f"/manual-bridge/requests/{request_id}/reject", method="POST", body={"error": error_text})


def _render_prompt_block(prompt: str) -> None:
    st.caption("Prompt copied from pending AI request")
    _render_copy_button(prompt, key=f"prompt_{abs(hash(prompt))}", label="Copy Prompt")
    st.code(prompt, language="text")


def _render_request_card(item: Dict[str, Any]) -> None:
    request_id = item.get("id", "")
    op = item.get("operation", "llm_call")
    created = _fmt_time(item.get("createdAt"))

    with st.container(border=True):
        st.markdown(f"**{op}**")
        st.caption(f"request_id: {request_id}")
        st.caption(f"created: {created}")

        prompt = str(item.get("prompt") or "")
        _render_prompt_block(prompt)

        with st.expander("Prompt (wrapped preview)", expanded=False):
            st.text(textwrap.fill(prompt, width=110))

        default_response = st.session_state.get(f"response_{request_id}", "")
        response_text = st.text_area(
            "Paste model response here",
            value=default_response,
            height=220,
            key=f"response_text_{request_id}",
            placeholder='Paste plain text or strict JSON output from Gemini/ChatGPT here.',
        )

        _render_copy_button(response_text, key=f"response_{request_id}", label="Copy Response")

        detected_ids = _extract_requirement_ids(response_text)
        if detected_ids:
            st.caption(f"Detected requirement IDs: {', '.join(detected_ids)}")

            project_id = str(st.session_state.get("bridge_project_id", "")).strip()
            top_k_per_id = int(st.session_state.get("bridge_top_k_per_id", 2))
            auto_fetch = bool(st.session_state.get("bridge_auto_fetch", True))

            if not project_id:
                st.info("Set Project ID in sidebar to auto-fetch targeted chunks from ChromaDB.")
            elif auto_fetch:
                signature = f"{request_id}|{project_id}|{','.join(detected_ids)}|{top_k_per_id}"
                sig_key = f"bridge_fetch_sig_{request_id}"
                cache_key = f"bridge_fetch_chunks_{request_id}"

                if st.session_state.get(sig_key) != signature:
                    try:
                        with st.spinner("Auto-fetching targeted SRS chunks..."):
                            fetched = _fetch_target_chunks(project_id, detected_ids, top_k_per_id)
                        st.session_state[cache_key] = fetched
                        st.session_state[sig_key] = signature
                    except Exception as exc:
                        st.warning(f"Semantic fetch failed: {exc}")

                fetched_chunks = st.session_state.get(cache_key, [])
                if fetched_chunks:
                    st.success(f"Fetched {len(fetched_chunks)} chunk(s) for next-stage prompt.")
                    next_prompt = (
                        "You are an Elite Agile Product Manager.\n\n"
                        f"Target Requirement IDs: {', '.join(detected_ids)}\n\n"
                        "Fetched SRS Context:\n"
                        + "\n\n".join(fetched_chunks[:8])
                        + "\n\nProject State JSON:\n{PASTE_PROJECT_STATE_JSON_HERE}\n\n"
                        "Return ONLY valid JSON with implementation-ready suggestions."
                    )
                    st.caption("Next-stage prompt draft")
                    _render_copy_button(next_prompt, key=f"next_{request_id}", label="Copy Next Prompt")
                    st.code(next_prompt, language="text")

        col_a, col_b, col_c = st.columns([1, 1, 2])
        with col_a:
            if st.button("Submit Response", key=f"submit_{request_id}", type="primary"):
                if not response_text.strip():
                    st.warning("Response text is required")
                else:
                    try:
                        _resolve(request_id, response_text.strip())
                        st.success("Response submitted")
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Failed to submit response: {exc}")

        with col_b:
            if st.button("Reject", key=f"reject_{request_id}"):
                try:
                    _reject(request_id, "Rejected in manual bridge UI")
                    st.info("Request rejected")
                    st.rerun()
                except Exception as exc:
                    st.error(f"Failed to reject request: {exc}")

        with col_c:
            if st.button("Validate JSON", key=f"validate_{request_id}"):
                try:
                    json.loads(response_text)
                    st.success("Valid JSON")
                except Exception as exc:
                    st.warning(f"Not valid JSON: {exc}")


def main() -> None:
    st.set_page_config(page_title="DevTrack Manual AI Bridge", page_icon="AI", layout="wide")
    st.title("DevTrack Manual AI Bridge")
    st.caption("Receive AI prompts, copy to Gemini/ChatGPT, paste responses, and continue the app flow.")
    st.info("Copy buttons are enabled for each prompt/response. If FR/NFR IDs are detected in your pasted response, semantic fetch can trigger automatically.")

    with st.sidebar:
        st.subheader("Connection")
        st.session_state["ai_service_url"] = st.text_input("AI Service URL", value=_api_url())
        st.session_state["bridge_project_id"] = st.text_input(
            "Project ID for semantic fetch",
            value=st.session_state.get("bridge_project_id", ""),
            help="Used for /stories/chunks-by-ids when FR/NFR IDs are detected in response text.",
        )
        st.session_state["bridge_top_k_per_id"] = st.number_input(
            "Top K chunks per ID",
            min_value=1,
            max_value=10,
            value=int(st.session_state.get("bridge_top_k_per_id", 2)),
            step=1,
        )
        st.session_state["bridge_auto_fetch"] = st.checkbox(
            "Auto-fetch on ID detection",
            value=bool(st.session_state.get("bridge_auto_fetch", True)),
        )

        auto_refresh = st.checkbox("Auto refresh every 3s", value=True)
        if st.button("Refresh now"):
            st.rerun()

        try:
            stats = _fetch("/manual-bridge/stats").get("data", {})
            st.markdown("### Queue Stats")
            st.write(stats)
        except Exception as exc:
            if _is_network_issue(exc):
                st.info("AI service not reachable right now. Queue stats are temporarily unavailable.")
            else:
                st.warning(f"Could not load stats: {exc}")

    if auto_refresh:
        try:
            from streamlit_autorefresh import st_autorefresh

            st_autorefresh(interval=3000, key="manual_bridge_refresh")
        except Exception:
            st.caption("Install streamlit-autorefresh for automatic polling, or click Refresh now.")

    try:
        pending = _load_pending()
    except Exception as exc:
        if _is_network_issue(exc):
            st.info("No pending AI requests right now.")
            st.caption("If you expected requests, verify that the AI service is running and reachable.")
            pending = []
        else:
            st.error(f"Failed to load pending requests: {exc}")
            return

    st.subheader(f"Pending AI Requests ({len(pending)})")
    if not pending:
        st.info("No pending AI requests right now.")
    else:
        for item in pending:
            _render_request_card(item)

    st.divider()
    st.subheader("Recent Requests")
    try:
        recent = _load_recent()
        if not recent:
            st.caption("No recent requests found.")
        else:
            for row in recent[:20]:
                st.write({
                    "id": row.get("id"),
                    "status": row.get("status"),
                    "operation": row.get("operation"),
                    "createdAt": _fmt_time(row.get("createdAt")),
                    "updatedAt": _fmt_time(row.get("updatedAt")),
                })
    except Exception as exc:
        if _is_network_issue(exc):
            st.caption("Recent requests unavailable while AI service is unreachable.")
        else:
            st.warning(f"Failed to load recent requests: {exc}")


if __name__ == "__main__":
    main()
