from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx
import streamlit as st
from dotenv import load_dotenv

REQUEST_TIMEOUT_SECONDS = 90.0
HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]
INVALID_JSON = "__invalid_json__"

APP_CSS = """
<style>
    .stApp {
        background: radial-gradient(circle at 5% 10%, #d7f0ff 0, transparent 35%),
                    radial-gradient(circle at 95% 5%, #ffe8d9 0, transparent 28%),
                    linear-gradient(180deg, #f7fbff 0%, #f4f8f7 100%);
    }
    .devtrack-card {
        background: rgba(255, 255, 255, 0.86);
        border: 1px solid rgba(25, 91, 158, 0.12);
        border-radius: 14px;
        padding: 0.95rem 1rem;
        box-shadow: 0 8px 24px rgba(12, 43, 84, 0.08);
        margin-bottom: 0.65rem;
    }
    .devtrack-kpi {
        font-size: 0.78rem;
        color: #3a4d61;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .devtrack-kpi-value {
        font-size: 1.28rem;
        color: #0f1f30;
        font-weight: 700;
        margin-top: 0.25rem;
    }
    .devtrack-section-title {
        font-size: 1.06rem;
        font-weight: 700;
        color: #16324b;
        margin: 0.2rem 0 0.5rem 0;
    }
    .devtrack-subtle {
        color: #4f647a;
        font-size: 0.86rem;
    }
</style>
"""


def inject_global_styles() -> None:
    st.markdown(APP_CSS, unsafe_allow_html=True)


def render_card(title: str, subtitle: str = "") -> None:
    subtitle_html = f"<div class='devtrack-subtle'>{subtitle}</div>" if subtitle else ""
    st.markdown(
        (
            "<div class='devtrack-card'>"
            f"<div class='devtrack-section-title'>{title}</div>"
            f"{subtitle_html}"
            "</div>"
        ),
        unsafe_allow_html=True,
    )


def render_kpi(label: str, value: Any) -> None:
    st.markdown(
        (
            "<div class='devtrack-card'>"
            f"<div class='devtrack-kpi'>{label}</div>"
            f"<div class='devtrack-kpi-value'>{value}</div>"
            "</div>"
        ),
        unsafe_allow_html=True,
    )


def safe_json(response: httpx.Response) -> Any | None:
    try:
        return response.json()
    except ValueError:
        return None


def extract_table_rows(data: Any) -> list[dict[str, Any]] | None:
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data
    if isinstance(data, dict):
        for key in (
            "values",
            "issues",
            "items",
            "repositories",
            "comments",
            "worklogs",
            "webhooks",
            "files",
            "events",
        ):
            candidate = data.get(key)
            if isinstance(candidate, list) and candidate and isinstance(candidate[0], dict):
                return candidate
    return None


def compact_rows(rows: list[dict[str, Any]], keys: list[str]) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    for row in rows:
        compacted.append({key: row.get(key) for key in keys if key in row})
    return compacted


def run_jira_request(
    profile: dict[str, str],
    method: str,
    endpoint: str,
    params: dict[str, Any] | None = None,
    body: Any | None = None,
    files: list[tuple[str, tuple[str, bytes, str]]] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> httpx.Response | None:
    headers = {"Accept": "application/json"}
    if extra_headers:
        headers.update(extra_headers)

    try:
        return call_api(
            base_url=profile["base_url"],
            method=method,
            endpoint=endpoint,
            headers=headers,
            params=params,
            body=body,
            auth=(profile["email"], profile["token"]),
            files=files,
        )
    except httpx.RequestError as exc:
        st.error(f"Jira request failed: {exc}")
        return None


def run_github_request(
    github_token: str,
    method: str,
    endpoint: str,
    params: dict[str, Any] | None = None,
    body: Any | None = None,
) -> httpx.Response | None:
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {github_token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    try:
        return call_api(
            base_url="https://api.github.com",
            method=method,
            endpoint=endpoint,
            headers=headers,
            params=params,
            body=body,
            auth=None,
            files=None,
        )
    except httpx.RequestError as exc:
        st.error(f"GitHub request failed: {exc}")
        return None


def env_value(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    if value is None:
        return default
    return value.strip().strip('"').strip("'")


def load_environment() -> None:
    dotenv_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(dotenv_path)


def slugify(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()


def adf_text_document(text: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": text}],
            }
        ],
    }


def collect_jira_profiles() -> dict[str, dict[str, str]]:
    profiles: dict[str, dict[str, str]] = {}

    base_url = env_value("JIRA_BASE_URL")
    email = env_value("JIRA_EMAIL")
    token = env_value("JIRA_API_TOKEN")
    if base_url and email and token:
        profiles["Default"] = {
            "base_url": base_url,
            "email": email,
            "token": token,
        }

    for index in range(1, 6):
        server = env_value(f"JIRA_SERVER{index}")
        account_email = env_value(f"JIRA_EMAIL{index}")
        account_token = env_value(f"JIRA_API_TOKEN{index}")
        if server and account_email and account_token:
            profiles[f"Account {index}"] = {
                "base_url": server,
                "email": account_email,
                "token": account_token,
            }

    return profiles


def jira_operation_templates(project_key: str) -> dict[str, dict[str, dict[str, Any]]]:
    safe_project_key = project_key or "PROJ"
    sample_issue_key = f"{safe_project_key}-1"

    return {
        "1. Core: Issue Management": {
            "Search Issues (JQL)": {
                "description": "Run a JQL query to find issues.",
                "method": "POST",
                "path": "/rest/api/3/search",
                "body_defaults": {
                    "jql": f"project = {safe_project_key} ORDER BY updated DESC",
                    "startAt": 0,
                    "maxResults": 50,
                },
            },
            "Create Issue": {
                "description": "Create a new task, bug, story, or other issue type.",
                "method": "POST",
                "path": "/rest/api/3/issue",
                "body_defaults": {
                    "fields": {
                        "project": {"key": safe_project_key},
                        "summary": "Issue created from Streamlit",
                        "description": adf_text_document(
                            "Created via DevTrack Streamlit Jira console"
                        ),
                        "issuetype": {"name": "Task"},
                    }
                },
            },
            "Update Issue Fields": {
                "description": "Update one or more fields in an existing issue.",
                "method": "PUT",
                "path": "/rest/api/3/issue/{issueIdOrKey}",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "body_defaults": {
                    "fields": {
                        "summary": "Updated summary from Streamlit",
                    }
                },
            },
            "Get Available Transitions": {
                "description": "List workflow transitions available for an issue.",
                "method": "GET",
                "path": "/rest/api/3/issue/{issueIdOrKey}/transitions",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
            },
            "Transition Issue": {
                "description": "Move an issue to a different workflow status.",
                "method": "POST",
                "path": "/rest/api/3/issue/{issueIdOrKey}/transitions",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "body_defaults": {
                    "transition": {"id": "31"},
                },
            },
            "List Comments": {
                "description": "Fetch comments for a Jira issue.",
                "method": "GET",
                "path": "/rest/api/3/issue/{issueIdOrKey}/comment",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "Add Comment": {
                "description": "Add a comment to an issue.",
                "method": "POST",
                "path": "/rest/api/3/issue/{issueIdOrKey}/comment",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "body_defaults": {
                    "body": adf_text_document("Comment added from Streamlit"),
                },
            },
            "Update Comment": {
                "description": "Edit an existing issue comment.",
                "method": "PUT",
                "path": "/rest/api/3/issue/{issueIdOrKey}/comment/{commentId}",
                "path_params": ["issueIdOrKey", "commentId"],
                "path_defaults": {
                    "issueIdOrKey": sample_issue_key,
                    "commentId": "10000",
                },
                "body_defaults": {
                    "body": adf_text_document("Updated comment from Streamlit"),
                },
            },
            "Delete Comment": {
                "description": "Delete an issue comment.",
                "method": "DELETE",
                "path": "/rest/api/3/issue/{issueIdOrKey}/comment/{commentId}",
                "path_params": ["issueIdOrKey", "commentId"],
                "path_defaults": {
                    "issueIdOrKey": sample_issue_key,
                    "commentId": "10000",
                },
            },
            "Upload Attachment": {
                "description": "Upload one or more files to an issue.",
                "method": "POST",
                "path": "/rest/api/3/issue/{issueIdOrKey}/attachments",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "file_upload": True,
                "extra_headers": {"X-Atlassian-Token": "no-check"},
            },
            "List Worklogs": {
                "description": "Retrieve worklogs for an issue.",
                "method": "GET",
                "path": "/rest/api/3/issue/{issueIdOrKey}/worklog",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "Add Worklog": {
                "description": "Log time spent on an issue.",
                "method": "POST",
                "path": "/rest/api/3/issue/{issueIdOrKey}/worklog",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "body_defaults": {
                    "timeSpent": "1h",
                    "comment": adf_text_document("Worklog entry from Streamlit"),
                },
            },
            "Update Worklog": {
                "description": "Update an existing worklog entry.",
                "method": "PUT",
                "path": "/rest/api/3/issue/{issueIdOrKey}/worklog/{worklogId}",
                "path_params": ["issueIdOrKey", "worklogId"],
                "path_defaults": {
                    "issueIdOrKey": sample_issue_key,
                    "worklogId": "10000",
                },
                "body_defaults": {
                    "timeSpent": "2h",
                    "comment": adf_text_document("Updated worklog from Streamlit"),
                },
            },
            "Delete Worklog": {
                "description": "Delete an issue worklog entry.",
                "method": "DELETE",
                "path": "/rest/api/3/issue/{issueIdOrKey}/worklog/{worklogId}",
                "path_params": ["issueIdOrKey", "worklogId"],
                "path_defaults": {
                    "issueIdOrKey": sample_issue_key,
                    "worklogId": "10000",
                },
            },
            "Create Issue Link": {
                "description": "Create relationships between two issues.",
                "method": "POST",
                "path": "/rest/api/3/issueLink",
                "body_defaults": {
                    "type": {"name": "Relates"},
                    "inwardIssue": {"key": sample_issue_key},
                    "outwardIssue": {"key": f"{safe_project_key}-2"},
                    "comment": {"body": adf_text_document("Link created from Streamlit")},
                },
            },
            "Get Watchers": {
                "description": "Get users watching an issue.",
                "method": "GET",
                "path": "/rest/api/3/issue/{issueIdOrKey}/watchers",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
            },
            "Add Watcher": {
                "description": "Add a watcher to an issue using accountId.",
                "method": "POST",
                "path": "/rest/api/3/issue/{issueIdOrKey}/watchers",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "body_defaults": "account-id-here",
            },
            "Remove Watcher": {
                "description": "Remove a watcher from an issue.",
                "method": "DELETE",
                "path": "/rest/api/3/issue/{issueIdOrKey}/watchers",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
                "query_defaults": {"accountId": "account-id-here"},
            },
            "Get Votes": {
                "description": "Get voters for an issue.",
                "method": "GET",
                "path": "/rest/api/3/issue/{issueIdOrKey}/votes",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
            },
            "Add Vote": {
                "description": "Vote on an issue as the current user.",
                "method": "POST",
                "path": "/rest/api/3/issue/{issueIdOrKey}/votes",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
            },
            "Remove Vote": {
                "description": "Remove your vote from an issue.",
                "method": "DELETE",
                "path": "/rest/api/3/issue/{issueIdOrKey}/votes",
                "path_params": ["issueIdOrKey"],
                "path_defaults": {"issueIdOrKey": sample_issue_key},
            },
        },
        "2. Project Organization": {
            "List Projects": {
                "description": "List Jira projects visible to this account.",
                "method": "GET",
                "path": "/rest/api/3/project/search",
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "Get Project Details": {
                "description": "Get metadata for a single project.",
                "method": "GET",
                "path": "/rest/api/3/project/{projectIdOrKey}",
                "path_params": ["projectIdOrKey"],
                "path_defaults": {"projectIdOrKey": safe_project_key},
            },
            "List Project Versions": {
                "description": "List release versions for a project.",
                "method": "GET",
                "path": "/rest/api/3/project/{projectIdOrKey}/versions",
                "path_params": ["projectIdOrKey"],
                "path_defaults": {"projectIdOrKey": safe_project_key},
            },
            "Create Version": {
                "description": "Create a new release version.",
                "method": "POST",
                "path": "/rest/api/3/version",
                "body_defaults": {
                    "name": "Release 1.0",
                    "projectId": 10000,
                    "description": "Version created from Streamlit",
                },
            },
            "List Project Components": {
                "description": "List components under a project.",
                "method": "GET",
                "path": "/rest/api/3/project/{projectIdOrKey}/components",
                "path_params": ["projectIdOrKey"],
                "path_defaults": {"projectIdOrKey": safe_project_key},
            },
            "Create Component": {
                "description": "Create a new project component.",
                "method": "POST",
                "path": "/rest/api/3/component",
                "body_defaults": {
                    "name": "Backend",
                    "project": safe_project_key,
                    "description": "Component created from Streamlit",
                },
            },
            "Update Component": {
                "description": "Edit an existing component.",
                "method": "PUT",
                "path": "/rest/api/3/component/{componentId}",
                "path_params": ["componentId"],
                "path_defaults": {"componentId": "10000"},
                "body_defaults": {
                    "name": "Backend",
                    "description": "Updated from Streamlit",
                },
            },
            "Delete Component": {
                "description": "Delete a project component.",
                "method": "DELETE",
                "path": "/rest/api/3/component/{componentId}",
                "path_params": ["componentId"],
                "path_defaults": {"componentId": "10000"},
            },
            "List Project Roles": {
                "description": "See role mapping for a project.",
                "method": "GET",
                "path": "/rest/api/3/project/{projectIdOrKey}/role",
                "path_params": ["projectIdOrKey"],
                "path_defaults": {"projectIdOrKey": safe_project_key},
            },
        },
        "3. Jira Software: Agile Features": {
            "List Boards": {
                "description": "Fetch Scrum/Kanban boards.",
                "method": "GET",
                "path": "/rest/agile/1.0/board",
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "Get Board Configuration": {
                "description": "Get board settings and filter details.",
                "method": "GET",
                "path": "/rest/agile/1.0/board/{boardId}/configuration",
                "path_params": ["boardId"],
                "path_defaults": {"boardId": "1"},
            },
            "List Board Sprints": {
                "description": "List sprints for a board.",
                "method": "GET",
                "path": "/rest/agile/1.0/board/{boardId}/sprint",
                "path_params": ["boardId"],
                "path_defaults": {"boardId": "1"},
                "query_defaults": {"state": "active,future,closed", "maxResults": 50},
            },
            "Create Sprint": {
                "description": "Create a sprint on a board.",
                "method": "POST",
                "path": "/rest/agile/1.0/sprint",
                "body_defaults": {
                    "name": "Sprint via Streamlit",
                    "originBoardId": 1,
                    "goal": "Sprint goal set from API",
                },
            },
            "Update Sprint State": {
                "description": "Start or complete a sprint.",
                "method": "PUT",
                "path": "/rest/agile/1.0/sprint/{sprintId}",
                "path_params": ["sprintId"],
                "path_defaults": {"sprintId": "1"},
                "body_defaults": {"state": "active"},
            },
            "Get Epic Details": {
                "description": "Fetch one epic by id or key.",
                "method": "GET",
                "path": "/rest/agile/1.0/epic/{epicIdOrKey}",
                "path_params": ["epicIdOrKey"],
                "path_defaults": {"epicIdOrKey": sample_issue_key},
            },
            "List Epic Issues": {
                "description": "Get issues that belong to an epic.",
                "method": "GET",
                "path": "/rest/agile/1.0/epic/{epicIdOrKey}/issue",
                "path_params": ["epicIdOrKey"],
                "path_defaults": {"epicIdOrKey": sample_issue_key},
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "Get Board Backlog": {
                "description": "List backlog issues for a board.",
                "method": "GET",
                "path": "/rest/agile/1.0/board/{boardId}/backlog",
                "path_params": ["boardId"],
                "path_defaults": {"boardId": "1"},
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "Move Issues to Backlog": {
                "description": "Move issues back to backlog.",
                "method": "POST",
                "path": "/rest/agile/1.0/backlog/issue",
                "body_defaults": {"issues": [sample_issue_key]},
            },
            "Rank Issues": {
                "description": "Rank issues higher/lower in backlog.",
                "method": "PUT",
                "path": "/rest/agile/1.0/issue/rank",
                "body_defaults": {
                    "issues": [sample_issue_key],
                    "rankAfterIssue": f"{safe_project_key}-2",
                },
            },
        },
        "4. Search and Discovery (JQL)": {
            "Execute JQL Search": {
                "description": "Run JQL and page through matching issues.",
                "method": "POST",
                "path": "/rest/api/3/search",
                "body_defaults": {
                    "jql": f"project = {safe_project_key} ORDER BY created DESC",
                    "startAt": 0,
                    "maxResults": 50,
                },
            },
            "List Saved Filters": {
                "description": "Get filters available to this account.",
                "method": "GET",
                "path": "/rest/api/3/filter/search",
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "Create Filter": {
                "description": "Create and save a reusable JQL filter.",
                "method": "POST",
                "path": "/rest/api/3/filter",
                "body_defaults": {
                    "name": "Streamlit Filter",
                    "description": "Created from DevTrack Streamlit app",
                    "jql": f"project = {safe_project_key} ORDER BY updated DESC",
                    "favourite": False,
                },
            },
            "Get Filter Details": {
                "description": "Fetch one filter by ID.",
                "method": "GET",
                "path": "/rest/api/3/filter/{filterId}",
                "path_params": ["filterId"],
                "path_defaults": {"filterId": "10000"},
            },
            "List Dashboards": {
                "description": "List dashboards visible to this account.",
                "method": "GET",
                "path": "/rest/api/3/dashboard",
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "Get Dashboard Gadgets": {
                "description": "Inspect gadgets/widgets on a dashboard.",
                "method": "GET",
                "path": "/rest/api/3/dashboard/{dashboardId}/gadget",
                "path_params": ["dashboardId"],
                "path_defaults": {"dashboardId": "10000"},
                "query_defaults": {"maxResults": 50},
            },
        },
        "5. Users, Groups, and Permissions": {
            "Find Users": {
                "description": "Search users by query string.",
                "method": "GET",
                "path": "/rest/api/3/user/search",
                "query_defaults": {"query": "", "startAt": 0, "maxResults": 50},
            },
            "List Group Members": {
                "description": "List users in a Jira group.",
                "method": "GET",
                "path": "/rest/api/3/group/member",
                "query_defaults": {
                    "groupname": "jira-software-users",
                    "startAt": 0,
                    "maxResults": 50,
                },
            },
            "Add User to Group": {
                "description": "Add a user account to a Jira group.",
                "method": "POST",
                "path": "/rest/api/3/group/user",
                "query_defaults": {"groupname": "jira-software-users"},
                "body_defaults": {"accountId": "account-id-here"},
            },
            "Remove User from Group": {
                "description": "Remove a user account from a Jira group.",
                "method": "DELETE",
                "path": "/rest/api/3/group/user",
                "query_defaults": {
                    "groupname": "jira-software-users",
                    "accountId": "account-id-here",
                },
            },
            "Check User Permissions": {
                "description": "Validate if a user has project/global permissions.",
                "method": "POST",
                "path": "/rest/api/3/permissions/check",
                "body_defaults": {
                    "accountId": "account-id-here",
                    "projectPermissions": [
                        {
                            "projectKey": safe_project_key,
                            "permissions": ["BROWSE_PROJECTS", "EDIT_ISSUES"],
                        }
                    ],
                },
            },
        },
        "6. System Configuration and Metadata": {
            "List Custom Fields": {
                "description": "Get all Jira fields including custom fields.",
                "method": "GET",
                "path": "/rest/api/3/field",
            },
            "List Issue Types": {
                "description": "List issue types available in Jira.",
                "method": "GET",
                "path": "/rest/api/3/issuetype",
            },
            "Get Create Metadata": {
                "description": "Discover required fields for issue creation.",
                "method": "GET",
                "path": "/rest/api/3/issue/createmeta",
                "query_defaults": {
                    "projectKeys": safe_project_key,
                    "expand": "projects.issuetypes.fields",
                },
            },
            "Search Workflows": {
                "description": "Inspect workflows and transition structure.",
                "method": "GET",
                "path": "/rest/api/3/workflow/search",
                "query_defaults": {"startAt": 0, "maxResults": 50},
            },
            "List Priorities": {
                "description": "List configured priority levels.",
                "method": "GET",
                "path": "/rest/api/3/priority",
            },
            "List Resolutions": {
                "description": "List available resolution states.",
                "method": "GET",
                "path": "/rest/api/3/resolution",
            },
        },
        "7. Webhooks and Entity Properties": {
            "List Dynamic Webhooks": {
                "description": "List dynamically registered webhooks.",
                "method": "GET",
                "path": "/rest/api/3/webhook",
            },
            "Register Dynamic Webhook": {
                "description": "Create a dynamic webhook for Jira events.",
                "method": "POST",
                "path": "/rest/api/3/webhook",
                "body_defaults": {
                    "url": "https://example.com/jira-webhook",
                    "webhooks": [
                        {
                            "jqlFilter": f"project = {safe_project_key}",
                            "events": ["jira:issue_created", "jira:issue_updated"],
                        }
                    ],
                },
            },
            "Delete Dynamic Webhook": {
                "description": "Delete a dynamic webhook registration.",
                "method": "DELETE",
                "path": "/rest/api/3/webhook",
                "query_defaults": {"webhookId": "10000"},
            },
            "Get Issue Property": {
                "description": "Read custom entity property from an issue.",
                "method": "GET",
                "path": "/rest/api/3/issue/{issueIdOrKey}/properties/{propertyKey}",
                "path_params": ["issueIdOrKey", "propertyKey"],
                "path_defaults": {
                    "issueIdOrKey": sample_issue_key,
                    "propertyKey": "devtrack.meta",
                },
            },
            "Set Issue Property": {
                "description": "Write custom entity property on an issue.",
                "method": "PUT",
                "path": "/rest/api/3/issue/{issueIdOrKey}/properties/{propertyKey}",
                "path_params": ["issueIdOrKey", "propertyKey"],
                "path_defaults": {
                    "issueIdOrKey": sample_issue_key,
                    "propertyKey": "devtrack.meta",
                },
                "body_defaults": {"source": "streamlit", "enabled": True},
            },
            "Delete Issue Property": {
                "description": "Delete custom property from an issue.",
                "method": "DELETE",
                "path": "/rest/api/3/issue/{issueIdOrKey}/properties/{propertyKey}",
                "path_params": ["issueIdOrKey", "propertyKey"],
                "path_defaults": {
                    "issueIdOrKey": sample_issue_key,
                    "propertyKey": "devtrack.meta",
                },
            },
            "Get Project Property": {
                "description": "Read custom property from a project.",
                "method": "GET",
                "path": "/rest/api/3/project/{projectIdOrKey}/properties/{propertyKey}",
                "path_params": ["projectIdOrKey", "propertyKey"],
                "path_defaults": {
                    "projectIdOrKey": safe_project_key,
                    "propertyKey": "devtrack.meta",
                },
            },
            "Set Project Property": {
                "description": "Write custom property on a project.",
                "method": "PUT",
                "path": "/rest/api/3/project/{projectIdOrKey}/properties/{propertyKey}",
                "path_params": ["projectIdOrKey", "propertyKey"],
                "path_defaults": {
                    "projectIdOrKey": safe_project_key,
                    "propertyKey": "devtrack.meta",
                },
                "body_defaults": {"source": "streamlit", "project": safe_project_key},
            },
            "Delete Project Property": {
                "description": "Delete custom property from a project.",
                "method": "DELETE",
                "path": "/rest/api/3/project/{projectIdOrKey}/properties/{propertyKey}",
                "path_params": ["projectIdOrKey", "propertyKey"],
                "path_defaults": {
                    "projectIdOrKey": safe_project_key,
                    "propertyKey": "devtrack.meta",
                },
            },
        },
    }


def github_operation_templates(
    owner: str,
    repo: str,
    org: str,
) -> dict[str, dict[str, dict[str, Any]]]:
    safe_owner = owner or "owner"
    safe_repo = repo or "repo"
    safe_org = org or safe_owner

    return {
        "1. People and Access": {
            "List Organization Members": {
                "description": "Get all users in an organization.",
                "method": "GET",
                "path": "/orgs/{org}/members",
                "path_params": ["org"],
                "path_defaults": {"org": safe_org},
                "query_defaults": {"per_page": 100, "page": 1},
            },
            "List Repository Collaborators": {
                "description": "List users with direct access to a repository.",
                "method": "GET",
                "path": "/repos/{owner}/{repo}/collaborators",
                "path_params": ["owner", "repo"],
                "path_defaults": {"owner": safe_owner, "repo": safe_repo},
                "query_defaults": {"per_page": 100, "page": 1},
            },
            "List Repository Contributors": {
                "description": "List contributors and total commit counts.",
                "method": "GET",
                "path": "/repos/{owner}/{repo}/contributors",
                "path_params": ["owner", "repo"],
                "path_defaults": {"owner": safe_owner, "repo": safe_repo},
                "query_defaults": {"per_page": 100, "page": 1},
            },
        },
        "2. Repository Details": {
            "List Organization Repositories": {
                "description": "Get all repositories in an organization.",
                "method": "GET",
                "path": "/orgs/{org}/repos",
                "path_params": ["org"],
                "path_defaults": {"org": safe_org},
                "query_defaults": {
                    "type": "all",
                    "sort": "updated",
                    "per_page": 100,
                    "page": 1,
                },
            },
            "Get Single Repository Details": {
                "description": "Fetch full metadata for one repository.",
                "method": "GET",
                "path": "/repos/{owner}/{repo}",
                "path_params": ["owner", "repo"],
                "path_defaults": {"owner": safe_owner, "repo": safe_repo},
            },
        },
        "3. Commits and Code Changes": {
            "List Commits by Author": {
                "description": "Filter commit history for one author.",
                "method": "GET",
                "path": "/repos/{owner}/{repo}/commits",
                "path_params": ["owner", "repo"],
                "path_defaults": {"owner": safe_owner, "repo": safe_repo},
                "query_defaults": {"author": "", "per_page": 50, "page": 1},
            },
            "Get Commit Details (Diff/Patch)": {
                "description": "Inspect exact files and lines changed in one commit.",
                "method": "GET",
                "path": "/repos/{owner}/{repo}/commits/{commit_sha}",
                "path_params": ["owner", "repo", "commit_sha"],
                "path_defaults": {
                    "owner": safe_owner,
                    "repo": safe_repo,
                    "commit_sha": "paste-commit-sha-here",
                },
            },
        },
        "4. Activity Timeline": {
            "List Repository Events": {
                "description": "Get recent repo activity events timeline.",
                "method": "GET",
                "path": "/repos/{owner}/{repo}/events",
                "path_params": ["owner", "repo"],
                "path_defaults": {"owner": safe_owner, "repo": safe_repo},
                "query_defaults": {"per_page": 30, "page": 1},
            },
        },
    }


def parse_json_input(
    label: str,
    key: str,
    default_value: Any | None = None,
    height: int = 180,
) -> Any:
    default_text = ""
    if default_value is not None:
        default_text = json.dumps(default_value, indent=2)

    raw = st.text_area(label, value=default_text, height=height, key=key)
    if not raw.strip():
        return None

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        st.error(f"Invalid JSON in {label}: {exc}")
        return INVALID_JSON


def resolve_endpoint(path_template: str, values: dict[str, str]) -> tuple[str, list[str]]:
    endpoint = path_template
    for name, value in values.items():
        endpoint = endpoint.replace("{" + name + "}", value.strip())

    unresolved = re.findall(r"{([^{}]+)}", endpoint)
    return endpoint, unresolved


def sanitize_query_params(payload: Any) -> dict[str, Any] | None | str:
    if payload is None:
        return None
    if payload == INVALID_JSON:
        return INVALID_JSON
    if not isinstance(payload, dict):
        return INVALID_JSON

    clean: dict[str, Any] = {}
    for key, value in payload.items():
        if value in ("", None, [], {}):
            continue
        clean[key] = value

    return clean or None


def upload_payload(files: list[Any] | None) -> list[tuple[str, tuple[str, bytes, str]]] | None:
    if not files:
        return None

    prepared: list[tuple[str, tuple[str, bytes, str]]] = []
    for file in files:
        content_type = file.type or "application/octet-stream"
        prepared.append(("file", (file.name, file.getvalue(), content_type)))
    return prepared


def call_api(
    base_url: str,
    method: str,
    endpoint: str,
    headers: dict[str, str],
    params: dict[str, Any] | None,
    body: Any | None,
    auth: tuple[str, str] | None = None,
    files: list[tuple[str, tuple[str, bytes, str]]] | None = None,
) -> httpx.Response:
    url = f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}"
    request_headers = dict(headers)

    request_kwargs: dict[str, Any] = {
        "headers": request_headers,
        "params": params,
    }
    if auth:
        request_kwargs["auth"] = auth
    if files:
        request_kwargs["files"] = files
    elif body is not None and method.upper() in {"POST", "PUT", "PATCH", "DELETE"}:
        request_kwargs["json"] = body

    with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        return client.request(method.upper(), url, **request_kwargs)


def render_response(response: httpx.Response) -> None:
    is_success = 200 <= response.status_code < 300
    if is_success:
        st.success(f"Request succeeded (HTTP {response.status_code})")
    else:
        st.error(f"Request failed (HTTP {response.status_code})")

    response_data = safe_json(response)
    body_text = response.text.strip() or "<no response body>"

    col1, col2, col3 = st.columns(3)
    with col1:
        render_kpi("Status Code", response.status_code)
    with col2:
        render_kpi("Response Bytes", len(response.content))
    with col3:
        render_kpi(
            "Rate Limit Remaining",
            response.headers.get("x-ratelimit-remaining", "N/A"),
        )

    summary_tab, table_tab, raw_tab = st.tabs(["Summary", "Table", "Raw JSON / Text"])

    with summary_tab:
        if isinstance(response_data, dict):
            keys_preview = ", ".join(list(response_data.keys())[:10]) or "No keys"
            st.caption(f"Top-level keys: {keys_preview}")
            st.json(response_data)
        elif isinstance(response_data, list):
            st.caption(f"Returned array length: {len(response_data)}")
            st.json(response_data)
        else:
            st.text(body_text)

    with table_tab:
        table_rows = extract_table_rows(response_data)
        if table_rows:
            st.dataframe(table_rows, use_container_width=True)
        else:
            st.info("No tabular list detected for this response.")

    with raw_tab:
        if response_data is not None:
            st.code(json.dumps(response_data, indent=2), language="json")
        else:
            st.code(body_text, language="text")


def render_operation_inputs(
    scope_key: str,
    operation_name: str,
    operation: dict[str, Any],
) -> tuple[
    str,
    list[str],
    Any,
    Any,
    list[Any] | None,
    bool,
]:
    base_key = slugify(f"{scope_key}_{operation_name}")

    st.write(operation.get("description", ""))
    st.code(f"{operation['method']} {operation['path']}", language="text")

    path_values: dict[str, str] = {}
    for param in operation.get("path_params", []):
        default_value = operation.get("path_defaults", {}).get(param, "")
        path_values[param] = st.text_input(
            f"Path parameter: {param}",
            value=default_value,
            key=f"{base_key}_path_{param}",
        )

    endpoint, unresolved = resolve_endpoint(operation["path"], path_values)
    st.text_input(
        "Resolved endpoint",
        value=endpoint,
        disabled=True,
        key=f"{base_key}_resolved_endpoint",
    )

    query_payload: Any = None
    if "query_defaults" in operation:
        query_payload = parse_json_input(
            "Query parameters (JSON object)",
            key=f"{base_key}_query",
            default_value=operation.get("query_defaults", {}),
            height=140,
        )

    body_payload: Any = None
    if "body_defaults" in operation:
        body_payload = parse_json_input(
            "Request body (JSON)",
            key=f"{base_key}_body",
            default_value=operation.get("body_defaults"),
            height=220,
        )

    uploaded_files: list[Any] | None = None
    if operation.get("file_upload"):
        uploaded_files = st.file_uploader(
            "Select files to upload",
            accept_multiple_files=True,
            key=f"{base_key}_files",
        )

    run_clicked = st.button(
        f"Send {operation['method']} Request",
        type="primary",
        key=f"{base_key}_run",
    )
    return endpoint, unresolved, query_payload, body_payload, uploaded_files, run_clicked


def render_operation_runner(
    scope_key: str,
    templates: dict[str, dict[str, dict[str, Any]]],
    request_executor,
) -> None:
    categories = list(templates.keys())
    selected_category = st.selectbox(
        "Capability group",
        categories,
        key=f"{scope_key}_category",
    )

    operations = templates[selected_category]
    operation_names = list(operations.keys())
    selected_operation_name = st.selectbox(
        "Operation",
        operation_names,
        key=f"{scope_key}_operation_{slugify(selected_category)}",
    )

    operation = operations[selected_operation_name]
    endpoint, unresolved, query_payload, body_payload, files, run_clicked = render_operation_inputs(
        scope_key=scope_key,
        operation_name=selected_operation_name,
        operation=operation,
    )

    if not run_clicked:
        return

    if unresolved:
        st.error(f"Missing values for path parameters: {', '.join(unresolved)}")
        return

    clean_query = sanitize_query_params(query_payload)
    if clean_query == INVALID_JSON:
        st.error("Query parameters must be a valid JSON object.")
        return

    if body_payload == INVALID_JSON:
        st.error("Request body JSON is invalid.")
        return

    if operation.get("file_upload") and not files:
        st.error("This operation needs at least one uploaded file.")
        return

    prepared_files = upload_payload(files)

    request_executor(
        operation=operation,
        endpoint=endpoint,
        query_payload=clean_query,
        body_payload=body_payload,
        prepared_files=prepared_files,
    )


def render_jira_overview(profile: dict[str, str], project_key: str) -> None:
    render_card(
        "Jira Command Center",
        "Portfolio snapshot for projects, issues, and boards in one view.",
    )

    refresh_clicked = st.button(
        "Refresh Jira Snapshot",
        key="jira_overview_refresh",
        use_container_width=True,
    )

    snapshot_key = "jira_overview_snapshot"
    if refresh_clicked or snapshot_key not in st.session_state:
        with st.spinner("Fetching projects, issues, and agile boards..."):
            projects_resp = run_jira_request(
                profile,
                "GET",
                "/rest/api/3/project/search",
                params={"startAt": 0, "maxResults": 100},
            )
            issues_resp = run_jira_request(
                profile,
                "POST",
                "/rest/api/3/search",
                body={
                    "jql": f"project = {project_key} ORDER BY updated DESC",
                    "startAt": 0,
                    "maxResults": 30,
                },
            )
            boards_resp = run_jira_request(
                profile,
                "GET",
                "/rest/agile/1.0/board",
                params={"startAt": 0, "maxResults": 50},
            )

        st.session_state[snapshot_key] = {
            "projects": (
                safe_json(projects_resp).get("values", [])
                if projects_resp and isinstance(safe_json(projects_resp), dict)
                else []
            ),
            "issues": (
                safe_json(issues_resp).get("issues", [])
                if issues_resp and isinstance(safe_json(issues_resp), dict)
                else []
            ),
            "boards": (
                safe_json(boards_resp).get("values", [])
                if boards_resp and isinstance(safe_json(boards_resp), dict)
                else []
            ),
            "synced_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

    snapshot = st.session_state.get(snapshot_key)
    if not snapshot:
        st.info("No Jira snapshot loaded yet.")
        return

    projects = snapshot.get("projects", [])
    issues = snapshot.get("issues", [])
    boards = snapshot.get("boards", [])

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        render_kpi("Projects", len(projects))
    with c2:
        render_kpi("Recent Issues", len(issues))
    with c3:
        render_kpi("Boards", len(boards))
    with c4:
        render_kpi("Synced At", snapshot.get("synced_at", "N/A"))

    projects_tab, issues_tab, boards_tab = st.tabs(["Projects", "Recent Issues", "Boards"])

    with projects_tab:
        project_rows = compact_rows(
            projects,
            ["id", "key", "name", "projectTypeKey", "simplified"],
        )
        if project_rows:
            st.dataframe(project_rows, use_container_width=True)
        else:
            st.info("No project data returned.")

    with issues_tab:
        issue_rows: list[dict[str, Any]] = []
        for item in issues:
            fields = item.get("fields", {}) if isinstance(item, dict) else {}
            status = fields.get("status", {}) if isinstance(fields, dict) else {}
            assignee = fields.get("assignee", {}) if isinstance(fields, dict) else {}
            issue_rows.append(
                {
                    "key": item.get("key") if isinstance(item, dict) else "",
                    "summary": fields.get("summary"),
                    "status": status.get("name") if isinstance(status, dict) else "",
                    "assignee": assignee.get("displayName")
                    if isinstance(assignee, dict)
                    else "",
                    "updated": fields.get("updated"),
                }
            )

        if issue_rows:
            st.dataframe(issue_rows, use_container_width=True)
        else:
            st.info("No issue data returned.")

    with boards_tab:
        board_rows = compact_rows(boards, ["id", "name", "type", "self"])
        if board_rows:
            st.dataframe(board_rows, use_container_width=True)
        else:
            st.info("No board data returned.")


def render_jira_issue_studio(profile: dict[str, str], project_key: str) -> None:
    render_card(
        "Issue Studio",
        "Create, transition, comment, and track time on issues from a guided workflow.",
    )

    col_create, col_flow = st.columns(2)

    with col_create:
        st.markdown("### Create Issue")
        with st.form("jira_create_issue_form"):
            create_project_key = st.text_input(
                "Project key",
                value=project_key,
                key="jira_create_project_key",
            )
            issue_type = st.selectbox(
                "Issue type",
                ["Task", "Bug", "Story", "Epic", "Sub-task"],
                key="jira_create_issue_type",
            )
            summary = st.text_input("Summary", key="jira_create_summary")
            description = st.text_area(
                "Description",
                key="jira_create_description",
                height=140,
            )
            priority_name = st.text_input(
                "Priority (optional)",
                value="",
                key="jira_create_priority",
            )
            assignee_account_id = st.text_input(
                "Assignee accountId (optional)",
                value="",
                key="jira_create_assignee",
            )
            create_submitted = st.form_submit_button("Create Issue", type="primary")

        if create_submitted:
            if not summary.strip():
                st.error("Summary is required.")
            else:
                fields: dict[str, Any] = {
                    "project": {"key": create_project_key.strip()},
                    "summary": summary.strip(),
                    "description": adf_text_document(
                        description.strip() or "Created from DevTrack Issue Studio"
                    ),
                    "issuetype": {"name": issue_type},
                }
                if priority_name.strip():
                    fields["priority"] = {"name": priority_name.strip()}
                if assignee_account_id.strip():
                    fields["assignee"] = {"accountId": assignee_account_id.strip()}

                response = run_jira_request(
                    profile,
                    "POST",
                    "/rest/api/3/issue",
                    body={"fields": fields},
                )
                if response is not None:
                    response_json = safe_json(response)
                    if isinstance(response_json, dict):
                        new_key = response_json.get("key")
                        if new_key:
                            st.session_state["jira_last_issue_key"] = new_key
                            st.success(f"Created issue: {new_key}")
                    render_response(response)

    with col_flow:
        st.markdown("### Workflow Transition")
        default_issue_key = st.session_state.get("jira_last_issue_key", f"{project_key}-1")
        transition_issue_key = st.text_input(
            "Issue key",
            value=default_issue_key,
            key="jira_transition_issue_key",
        )

        load_transitions_clicked = st.button(
            "Load Transitions",
            key="jira_load_transitions",
            use_container_width=True,
        )
        if load_transitions_clicked:
            response = run_jira_request(
                profile,
                "GET",
                f"/rest/api/3/issue/{transition_issue_key}/transitions",
            )
            if response is not None:
                payload = safe_json(response)
                transitions = payload.get("transitions", []) if isinstance(payload, dict) else []
                st.session_state["jira_loaded_transitions"] = transitions
                st.session_state["jira_loaded_transitions_issue"] = transition_issue_key
                render_response(response)

        transitions = st.session_state.get("jira_loaded_transitions", [])
        transitions_issue = st.session_state.get("jira_loaded_transitions_issue")
        if transitions and transitions_issue == transition_issue_key:
            selected_transition = st.selectbox(
                "Target status",
                transitions,
                format_func=lambda option: f"{option.get('name', '')} ({option.get('id', '')})",
                key="jira_transition_target",
            )
            if st.button(
                "Apply Transition",
                key="jira_apply_transition",
                use_container_width=True,
            ):
                transition_id = selected_transition.get("id")
                response = run_jira_request(
                    profile,
                    "POST",
                    f"/rest/api/3/issue/{transition_issue_key}/transitions",
                    body={"transition": {"id": transition_id}},
                )
                if response is not None:
                    render_response(response)
        else:
            st.caption("Load transitions to choose a target status.")

    action_comment, action_worklog, action_attachment = st.columns(3)

    with action_comment:
        st.markdown("### Add Comment")
        with st.form("jira_add_comment_form"):
            comment_issue_key = st.text_input(
                "Issue key",
                value=st.session_state.get("jira_last_issue_key", f"{project_key}-1"),
                key="jira_comment_issue_key",
            )
            comment_text = st.text_area("Comment", key="jira_comment_text", height=120)
            submit_comment = st.form_submit_button("Post Comment")

        if submit_comment:
            if not comment_text.strip():
                st.error("Comment text is required.")
            else:
                response = run_jira_request(
                    profile,
                    "POST",
                    f"/rest/api/3/issue/{comment_issue_key}/comment",
                    body={"body": adf_text_document(comment_text.strip())},
                )
                if response is not None:
                    render_response(response)

    with action_worklog:
        st.markdown("### Add Worklog")
        with st.form("jira_add_worklog_form"):
            worklog_issue_key = st.text_input(
                "Issue key",
                value=st.session_state.get("jira_last_issue_key", f"{project_key}-1"),
                key="jira_worklog_issue_key",
            )
            time_spent = st.text_input("Time spent", value="1h", key="jira_worklog_timespent")
            worklog_note = st.text_area("Note", key="jira_worklog_note", height=120)
            submit_worklog = st.form_submit_button("Add Worklog")

        if submit_worklog:
            response = run_jira_request(
                profile,
                "POST",
                f"/rest/api/3/issue/{worklog_issue_key}/worklog",
                body={
                    "timeSpent": time_spent.strip() or "1h",
                    "comment": adf_text_document(worklog_note.strip() or "Logged from Streamlit"),
                },
            )
            if response is not None:
                render_response(response)

    with action_attachment:
        st.markdown("### Upload Attachment")
        attachment_issue_key = st.text_input(
            "Issue key",
            value=st.session_state.get("jira_last_issue_key", f"{project_key}-1"),
            key="jira_attachment_issue_key",
        )
        files = st.file_uploader(
            "Choose file(s)",
            accept_multiple_files=True,
            key="jira_attachment_files",
        )
        if st.button("Upload Files", key="jira_upload_files", use_container_width=True):
            payload = upload_payload(files)
            if not payload:
                st.error("Please choose at least one file.")
            else:
                response = run_jira_request(
                    profile,
                    "POST",
                    f"/rest/api/3/issue/{attachment_issue_key}/attachments",
                    files=payload,
                    extra_headers={"X-Atlassian-Token": "no-check"},
                )
                if response is not None:
                    render_response(response)


def render_jira_agile_studio(profile: dict[str, str], project_key: str) -> None:
    render_card(
        "Agile Studio",
        "Operate boards, sprints, backlog placement, and ranking with guided controls.",
    )

    board_id_input = st.text_input("Board ID", value="1", key="jira_agile_board_id")
    board_id = board_id_input.strip() or "1"

    if st.button("Load Agile Snapshot", key="jira_agile_refresh", use_container_width=True):
        with st.spinner("Loading board config, sprints, and backlog..."):
            config_resp = run_jira_request(
                profile,
                "GET",
                f"/rest/agile/1.0/board/{board_id}/configuration",
            )
            sprint_resp = run_jira_request(
                profile,
                "GET",
                f"/rest/agile/1.0/board/{board_id}/sprint",
                params={"state": "active,future,closed", "maxResults": 50},
            )
            backlog_resp = run_jira_request(
                profile,
                "GET",
                f"/rest/agile/1.0/board/{board_id}/backlog",
                params={"startAt": 0, "maxResults": 50},
            )

        st.session_state["jira_agile_snapshot"] = {
            "board_id": board_id,
            "config": safe_json(config_resp) if config_resp else {},
            "sprints": (
                safe_json(sprint_resp).get("values", [])
                if sprint_resp and isinstance(safe_json(sprint_resp), dict)
                else []
            ),
            "backlog": (
                safe_json(backlog_resp).get("issues", [])
                if backlog_resp and isinstance(safe_json(backlog_resp), dict)
                else []
            ),
        }

    agile_snapshot = st.session_state.get("jira_agile_snapshot", {})
    if agile_snapshot and agile_snapshot.get("board_id") == board_id:
        sprints = agile_snapshot.get("sprints", [])
        backlog = agile_snapshot.get("backlog", [])

        k1, k2 = st.columns(2)
        with k1:
            render_kpi("Sprints", len(sprints))
        with k2:
            render_kpi("Backlog Issues", len(backlog))

        sprints_tab, backlog_tab, board_tab = st.tabs(["Sprints", "Backlog", "Board Config"])

        with sprints_tab:
            sprint_rows = compact_rows(
                sprints,
                ["id", "name", "state", "startDate", "endDate", "completeDate"],
            )
            if sprint_rows:
                st.dataframe(sprint_rows, use_container_width=True)
            else:
                st.info("No sprint data returned.")

        with backlog_tab:
            backlog_rows: list[dict[str, Any]] = []
            for item in backlog:
                fields = item.get("fields", {}) if isinstance(item, dict) else {}
                status = fields.get("status", {}) if isinstance(fields, dict) else {}
                backlog_rows.append(
                    {
                        "key": item.get("key") if isinstance(item, dict) else "",
                        "summary": fields.get("summary"),
                        "status": status.get("name") if isinstance(status, dict) else "",
                    }
                )
            if backlog_rows:
                st.dataframe(backlog_rows, use_container_width=True)
            else:
                st.info("No backlog issues returned.")

        with board_tab:
            config_data = agile_snapshot.get("config", {})
            if config_data:
                st.json(config_data)
            else:
                st.info("Board configuration not loaded yet.")

    c1, c2 = st.columns(2)
    with c1:
        st.markdown("### Create Sprint")
        with st.form("jira_create_sprint_form"):
            sprint_name = st.text_input("Sprint name", key="jira_sprint_name")
            sprint_goal = st.text_area("Goal", key="jira_sprint_goal", height=90)
            submit_create_sprint = st.form_submit_button("Create Sprint", type="primary")

        if submit_create_sprint:
            if not sprint_name.strip():
                st.error("Sprint name is required.")
            else:
                try:
                    origin_board_id = int(board_id)
                except ValueError:
                    st.error("Board ID must be numeric for sprint creation.")
                    origin_board_id = -1

                if origin_board_id > -1:
                    response = run_jira_request(
                        profile,
                        "POST",
                        "/rest/agile/1.0/sprint",
                        body={
                            "name": sprint_name.strip(),
                            "originBoardId": origin_board_id,
                            "goal": sprint_goal.strip(),
                        },
                    )
                    if response is not None:
                        render_response(response)

        st.markdown("### Update Sprint State")
        with st.form("jira_update_sprint_state_form"):
            sprint_id = st.text_input("Sprint ID", value="1", key="jira_update_sprint_id")
            sprint_state = st.selectbox(
                "State",
                ["future", "active", "closed"],
                key="jira_update_sprint_state",
            )
            submit_sprint_state = st.form_submit_button("Update Sprint")

        if submit_sprint_state:
            response = run_jira_request(
                profile,
                "PUT",
                f"/rest/agile/1.0/sprint/{sprint_id}",
                body={"state": sprint_state},
            )
            if response is not None:
                render_response(response)

    with c2:
        st.markdown("### Move Issues To Backlog")
        with st.form("jira_move_backlog_form"):
            issue_keys_input = st.text_area(
                "Issue keys (comma separated)",
                value=f"{project_key}-1, {project_key}-2",
                key="jira_backlog_issue_keys",
                height=90,
            )
            submit_move_backlog = st.form_submit_button("Move To Backlog", type="primary")

        if submit_move_backlog:
            issue_keys = [value.strip() for value in issue_keys_input.split(",") if value.strip()]
            if not issue_keys:
                st.error("Provide at least one issue key.")
            else:
                response = run_jira_request(
                    profile,
                    "POST",
                    "/rest/agile/1.0/backlog/issue",
                    body={"issues": issue_keys},
                )
                if response is not None:
                    render_response(response)

        st.markdown("### Rank Issues")
        with st.form("jira_rank_issues_form"):
            rank_issue_keys = st.text_area(
                "Issue keys (comma separated)",
                value=f"{project_key}-1",
                key="jira_rank_issue_keys",
                height=80,
            )
            rank_after = st.text_input(
                "Rank after issue (optional)",
                value=f"{project_key}-2",
                key="jira_rank_after",
            )
            rank_before = st.text_input(
                "Rank before issue (optional)",
                value="",
                key="jira_rank_before",
            )
            submit_rank = st.form_submit_button("Apply Rank")

        if submit_rank:
            keys = [value.strip() for value in rank_issue_keys.split(",") if value.strip()]
            if not keys:
                st.error("Provide at least one issue key.")
            else:
                payload: dict[str, Any] = {"issues": keys}
                if rank_after.strip():
                    payload["rankAfterIssue"] = rank_after.strip()
                if rank_before.strip():
                    payload["rankBeforeIssue"] = rank_before.strip()

                response = run_jira_request(
                    profile,
                    "PUT",
                    "/rest/agile/1.0/issue/rank",
                    body=payload,
                )
                if response is not None:
                    render_response(response)


def render_jira_admin_studio(profile: dict[str, str], project_key: str) -> None:
    render_card(
        "Admin Studio",
        "Manage users, groups, permissions, and Jira metadata from one place.",
    )

    users_tab, permissions_tab, metadata_tab = st.tabs(
        ["Users & Groups", "Permission Checks", "System Metadata"]
    )

    with users_tab:
        uc1, uc2 = st.columns(2)
        with uc1:
            st.markdown("### User Search")
            user_query = st.text_input("Query", value="", key="jira_user_query")
            if st.button("Search Users", key="jira_search_users"):
                response = run_jira_request(
                    profile,
                    "GET",
                    "/rest/api/3/user/search",
                    params={"query": user_query, "maxResults": 50},
                )
                if response is not None:
                    render_response(response)

        with uc2:
            st.markdown("### Group Operations")
            group_name = st.text_input(
                "Group name",
                value="jira-software-users",
                key="jira_group_name",
            )
            group_account_id = st.text_input(
                "Account ID",
                value="",
                key="jira_group_account_id",
            )
            g1, g2, g3 = st.columns(3)
            with g1:
                if st.button("List Members", key="jira_group_list_members"):
                    response = run_jira_request(
                        profile,
                        "GET",
                        "/rest/api/3/group/member",
                        params={"groupname": group_name, "maxResults": 50},
                    )
                    if response is not None:
                        render_response(response)
            with g2:
                if st.button("Add User", key="jira_group_add_user"):
                    response = run_jira_request(
                        profile,
                        "POST",
                        "/rest/api/3/group/user",
                        params={"groupname": group_name},
                        body={"accountId": group_account_id},
                    )
                    if response is not None:
                        render_response(response)
            with g3:
                if st.button("Remove User", key="jira_group_remove_user"):
                    response = run_jira_request(
                        profile,
                        "DELETE",
                        "/rest/api/3/group/user",
                        params={"groupname": group_name, "accountId": group_account_id},
                    )
                    if response is not None:
                        render_response(response)

    with permissions_tab:
        st.markdown("### Validate User Permissions")
        with st.form("jira_permission_form"):
            account_id = st.text_input("Account ID", key="jira_perm_account_id")
            project_for_perm = st.text_input(
                "Project key",
                value=project_key,
                key="jira_perm_project_key",
            )
            permissions_csv = st.text_input(
                "Permissions (comma separated)",
                value="BROWSE_PROJECTS, EDIT_ISSUES",
                key="jira_perm_permissions_csv",
            )
            check_permissions = st.form_submit_button("Check Permissions", type="primary")

        if check_permissions:
            permissions = [value.strip() for value in permissions_csv.split(",") if value.strip()]
            response = run_jira_request(
                profile,
                "POST",
                "/rest/api/3/permissions/check",
                body={
                    "accountId": account_id,
                    "projectPermissions": [
                        {
                            "projectKey": project_for_perm,
                            "permissions": permissions,
                        }
                    ],
                },
            )
            if response is not None:
                render_response(response)

    with metadata_tab:
        st.markdown("### Metadata Explorer")
        m1, m2, m3, m4, m5 = st.columns(5)
        with m1:
            if st.button("Fields", key="jira_meta_fields"):
                response = run_jira_request(profile, "GET", "/rest/api/3/field")
                if response is not None:
                    render_response(response)
        with m2:
            if st.button("Issue Types", key="jira_meta_issue_types"):
                response = run_jira_request(profile, "GET", "/rest/api/3/issuetype")
                if response is not None:
                    render_response(response)
        with m3:
            if st.button("Workflows", key="jira_meta_workflows"):
                response = run_jira_request(
                    profile,
                    "GET",
                    "/rest/api/3/workflow/search",
                    params={"maxResults": 50},
                )
                if response is not None:
                    render_response(response)
        with m4:
            if st.button("Priorities", key="jira_meta_priorities"):
                response = run_jira_request(profile, "GET", "/rest/api/3/priority")
                if response is not None:
                    render_response(response)
        with m5:
            if st.button("Resolutions", key="jira_meta_resolutions"):
                response = run_jira_request(profile, "GET", "/rest/api/3/resolution")
                if response is not None:
                    render_response(response)


def render_jira_console(profile: dict[str, str], project_key: str) -> None:
    render_card(
        "Advanced API Console",
        "Full endpoint coverage for power users, including all major Jira API domains.",
    )

    templates = jira_operation_templates(project_key=project_key)

    def jira_request_executor(
        operation: dict[str, Any],
        endpoint: str,
        query_payload: dict[str, Any] | None,
        body_payload: Any,
        prepared_files: list[tuple[str, tuple[str, bytes, str]]] | None,
    ) -> None:
        response = run_jira_request(
            profile,
            operation["method"],
            endpoint,
            params=query_payload,
            body=body_payload,
            files=prepared_files,
            extra_headers=operation.get("extra_headers", {}),
        )
        if response is not None:
            render_response(response)

    render_operation_runner(
        scope_key="jira",
        templates=templates,
        request_executor=jira_request_executor,
    )

    with st.expander("Custom Jira Request", expanded=False):
        method = st.selectbox("Method", HTTP_METHODS, key="jira_custom_method")
        endpoint = st.text_input(
            "Endpoint path",
            value="/rest/api/3/myself",
            key="jira_custom_endpoint",
        )
        query_payload = parse_json_input(
            "Query parameters (JSON object)",
            key="jira_custom_query",
            default_value={},
            height=120,
        )
        body_payload = parse_json_input(
            "Request body (JSON)",
            key="jira_custom_body",
            default_value={},
            height=180,
        )
        custom_files = st.file_uploader(
            "Files (optional, only needed for attachment endpoints)",
            accept_multiple_files=True,
            key="jira_custom_files",
        )

        if st.button("Send Custom Jira Request", key="jira_custom_run"):
            clean_query = sanitize_query_params(query_payload)
            if clean_query == INVALID_JSON:
                st.error("Query parameters must be a valid JSON object.")
            elif body_payload == INVALID_JSON:
                st.error("Request body JSON is invalid.")
            else:
                files_payload = upload_payload(custom_files)
                extra_headers: dict[str, str] = {}
                if files_payload:
                    extra_headers["X-Atlassian-Token"] = "no-check"

                body_to_send = None if method == "GET" and body_payload == {} else body_payload
                response = run_jira_request(
                    profile,
                    method,
                    endpoint,
                    params=clean_query,
                    body=body_to_send,
                    files=files_payload,
                    extra_headers=extra_headers,
                )
                if response is not None:
                    render_response(response)


def render_jira_tab() -> None:
    st.subheader("Jira Workspace")
    st.caption("Credentials are loaded from .env and mapped into a guided operations workspace.")

    jira_profiles = collect_jira_profiles()
    if not jira_profiles:
        st.error(
            "No Jira profiles found in .env. Add JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN."
        )
        return

    selected_profile_name = st.selectbox(
        "Jira account",
        list(jira_profiles.keys()),
        key="jira_profile_selector",
    )
    profile = jira_profiles[selected_profile_name]

    st.caption(f"Base URL: {profile['base_url']}")

    project_key = env_value("JIRA_PROJECT_KEY", "PROJ")
    workspace = st.radio(
        "Jira mode",
        [
            "Overview",
            "Issue Studio",
            "Agile Studio",
            "Admin Studio",
            "Advanced Console",
        ],
        horizontal=True,
        key="jira_workspace_mode",
    )

    if workspace == "Overview":
        render_jira_overview(profile, project_key)
    elif workspace == "Issue Studio":
        render_jira_issue_studio(profile, project_key)
    elif workspace == "Agile Studio":
        render_jira_agile_studio(profile, project_key)
    elif workspace == "Admin Studio":
        render_jira_admin_studio(profile, project_key)
    else:
        render_jira_console(profile, project_key)


def render_github_overview(
    github_token: str,
    owner_input: str,
    repo_input: str,
    org_input: str,
) -> None:
    render_card(
        "GitHub Operations Hub",
        "Snapshot of repositories, contributors, and recent repository activity.",
    )

    if st.button("Refresh GitHub Snapshot", key="github_overview_refresh", use_container_width=True):
        with st.spinner("Fetching repository, contributor, and event metrics..."):
            repos_resp = (
                run_github_request(
                    github_token,
                    "GET",
                    f"/orgs/{org_input}/repos",
                    params={"type": "all", "sort": "updated", "per_page": 100, "page": 1},
                )
                if org_input.strip()
                else None
            )
            contributors_resp = run_github_request(
                github_token,
                "GET",
                f"/repos/{owner_input}/{repo_input}/contributors",
                params={"per_page": 100, "page": 1},
            )
            events_resp = run_github_request(
                github_token,
                "GET",
                f"/repos/{owner_input}/{repo_input}/events",
                params={"per_page": 30, "page": 1},
            )

        st.session_state["github_overview_snapshot"] = {
            "repos": safe_json(repos_resp) if repos_resp and isinstance(safe_json(repos_resp), list) else [],
            "contributors": (
                safe_json(contributors_resp)
                if contributors_resp and isinstance(safe_json(contributors_resp), list)
                else []
            ),
            "events": safe_json(events_resp) if events_resp and isinstance(safe_json(events_resp), list) else [],
            "synced_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

    snapshot = st.session_state.get("github_overview_snapshot")
    if not snapshot:
        st.info("Click Refresh GitHub Snapshot to load overview data.")
        return

    repos = snapshot.get("repos", [])
    contributors = snapshot.get("contributors", [])
    events = snapshot.get("events", [])

    k1, k2, k3, k4 = st.columns(4)
    with k1:
        render_kpi("Repositories", len(repos))
    with k2:
        render_kpi("Contributors", len(contributors))
    with k3:
        render_kpi("Recent Events", len(events))
    with k4:
        render_kpi("Synced At", snapshot.get("synced_at", "N/A"))

    repos_tab, contributors_tab, events_tab = st.tabs(["Repositories", "Contributors", "Events"])

    with repos_tab:
        repo_rows = compact_rows(
            repos,
            ["name", "private", "language", "default_branch", "updated_at", "html_url"],
        )
        if repo_rows:
            st.dataframe(repo_rows, use_container_width=True)
        else:
            st.info("No repositories returned.")

    with contributors_tab:
        contributor_rows = compact_rows(
            contributors,
            ["login", "contributions", "type", "html_url"],
        )
        if contributor_rows:
            st.dataframe(contributor_rows, use_container_width=True)
        else:
            st.info("No contributors returned.")

    with events_tab:
        event_rows = []
        for item in events:
            actor = item.get("actor", {}) if isinstance(item, dict) else {}
            repo = item.get("repo", {}) if isinstance(item, dict) else {}
            event_rows.append(
                {
                    "type": item.get("type") if isinstance(item, dict) else "",
                    "actor": actor.get("login") if isinstance(actor, dict) else "",
                    "repo": repo.get("name") if isinstance(repo, dict) else "",
                    "created_at": item.get("created_at") if isinstance(item, dict) else "",
                }
            )
        if event_rows:
            st.dataframe(event_rows, use_container_width=True)
        else:
            st.info("No event data returned.")


def render_github_activity_studio(github_token: str, owner_input: str, repo_input: str) -> None:
    render_card(
        "Activity Studio",
        "Trace contributor activity, inspect commits, and view exact file-level code changes.",
    )

    c1, c2 = st.columns([2, 1])
    with c1:
        author = st.text_input("Author username", value="", key="github_activity_author")
    with c2:
        if st.button("Load Author Commits", key="github_load_author_commits", use_container_width=True):
            params = {"per_page": 50, "page": 1}
            if author.strip():
                params["author"] = author.strip()
            response = run_github_request(
                github_token,
                "GET",
                f"/repos/{owner_input}/{repo_input}/commits",
                params=params,
            )
            if response is not None:
                payload = safe_json(response)
                commits = payload if isinstance(payload, list) else []
                st.session_state["github_commits_cache"] = commits
                render_response(response)

    commits = st.session_state.get("github_commits_cache", [])
    if commits:
        commit_rows: list[dict[str, Any]] = []
        for item in commits:
            commit = item.get("commit", {}) if isinstance(item, dict) else {}
            commit_author = commit.get("author", {}) if isinstance(commit, dict) else {}
            commit_rows.append(
                {
                    "sha": item.get("sha") if isinstance(item, dict) else "",
                    "author": (item.get("author") or {}).get("login") if isinstance(item, dict) else "",
                    "date": commit_author.get("date") if isinstance(commit_author, dict) else "",
                    "message": (commit.get("message", "") or "")[:120],
                }
            )
        st.dataframe(commit_rows, use_container_width=True)

        selected_sha = st.selectbox(
            "Commit to inspect",
            [row["sha"] for row in commit_rows if row.get("sha")],
            key="github_selected_commit_sha",
        )
        if st.button("Inspect Commit Diff", key="github_inspect_commit", use_container_width=True):
            response = run_github_request(
                github_token,
                "GET",
                f"/repos/{owner_input}/{repo_input}/commits/{selected_sha}",
            )
            if response is not None:
                payload = safe_json(response)
                st.session_state["github_commit_detail"] = payload if isinstance(payload, dict) else {}
                render_response(response)

    commit_detail = st.session_state.get("github_commit_detail", {})
    files_changed = commit_detail.get("files", []) if isinstance(commit_detail, dict) else []
    if files_changed:
        st.markdown("### Changed Files")
        file_rows = compact_rows(
            files_changed,
            ["filename", "status", "additions", "deletions", "changes"],
        )
        st.dataframe(file_rows, use_container_width=True)

        with st.expander("View Patch Snippets", expanded=False):
            for item in files_changed[:8]:
                filename = item.get("filename", "unknown")
                patch = item.get("patch", "Patch not available for this file.")
                st.markdown(f"#### {filename}")
                st.code(patch, language="diff")


def render_github_team_studio(
    github_token: str,
    owner_input: str,
    repo_input: str,
    org_input: str,
) -> None:
    render_card(
        "Team & Access Studio",
        "Map organization members, repository collaborators, and contribution ownership.",
    )

    c1, c2, c3 = st.columns(3)
    with c1:
        if st.button("Load Org Members", key="github_load_org_members", use_container_width=True):
            if not org_input.strip():
                st.error("Organization is required for this action.")
            else:
                response = run_github_request(
                    github_token,
                    "GET",
                    f"/orgs/{org_input}/members",
                    params={"per_page": 100, "page": 1},
                )
                if response is not None:
                    render_response(response)

    with c2:
        if st.button("Load Collaborators", key="github_load_collaborators", use_container_width=True):
            response = run_github_request(
                github_token,
                "GET",
                f"/repos/{owner_input}/{repo_input}/collaborators",
                params={"per_page": 100, "page": 1},
            )
            if response is not None:
                render_response(response)

    with c3:
        if st.button("Load Contributors", key="github_load_contributors", use_container_width=True):
            response = run_github_request(
                github_token,
                "GET",
                f"/repos/{owner_input}/{repo_input}/contributors",
                params={"per_page": 100, "page": 1},
            )
            if response is not None:
                render_response(response)


def render_github_console(
    github_token: str,
    owner_input: str,
    repo_input: str,
    org_input: str,
) -> None:
    render_card(
        "Advanced API Console",
        "Run curated GitHub API templates or execute any custom endpoint.",
    )

    templates = github_operation_templates(
        owner=owner_input,
        repo=repo_input,
        org=org_input,
    )

    def github_request_executor(
        operation: dict[str, Any],
        endpoint: str,
        query_payload: dict[str, Any] | None,
        body_payload: Any,
        prepared_files: list[tuple[str, tuple[str, bytes, str]]] | None,
    ) -> None:
        _ = prepared_files
        response = run_github_request(
            github_token,
            operation["method"],
            endpoint,
            params=query_payload,
            body=body_payload,
        )
        if response is not None:
            render_response(response)

    render_operation_runner(
        scope_key="github",
        templates=templates,
        request_executor=github_request_executor,
    )

    with st.expander("Custom GitHub Request", expanded=False):
        method = st.selectbox("Method", HTTP_METHODS, key="github_custom_method")
        endpoint = st.text_input(
            "Endpoint path",
            value="/user",
            key="github_custom_endpoint",
        )
        query_payload = parse_json_input(
            "Query parameters (JSON object)",
            key="github_custom_query",
            default_value={},
            height=120,
        )
        body_payload = parse_json_input(
            "Request body (JSON)",
            key="github_custom_body",
            default_value={},
            height=180,
        )

        if st.button("Send Custom GitHub Request", key="github_custom_run"):
            clean_query = sanitize_query_params(query_payload)
            if clean_query == INVALID_JSON:
                st.error("Query parameters must be a valid JSON object.")
            elif body_payload == INVALID_JSON:
                st.error("Request body JSON is invalid.")
            else:
                body_to_send = None if method == "GET" and body_payload == {} else body_payload
                response = run_github_request(
                    github_token,
                    method,
                    endpoint,
                    params=clean_query,
                    body=body_to_send,
                )
                if response is not None:
                    render_response(response)


def render_github_tab() -> None:
    st.subheader("GitHub Workspace")
    st.caption("Track team activity, repository detail, and commit-level code changes from one UI.")

    github_token = env_value("GITHUB_TOKEN")
    default_owner = env_value("GITHUB_REPO_OWNER")
    default_repo = env_value("GITHUB_REPO_NAME")
    default_org = env_value("GITHUB_ORG") or default_owner

    if not github_token:
        st.error("Missing GITHUB_TOKEN in .env")
        return

    st.caption("GitHub API token detected.")

    owner_input = st.text_input("Default owner", value=default_owner, key="github_owner")
    repo_input = st.text_input("Default repository", value=default_repo, key="github_repo")
    org_input = st.text_input("Default organization", value=default_org, key="github_org")

    workspace = st.radio(
        "GitHub mode",
        ["Overview", "Activity Studio", "Team Studio", "Advanced Console"],
        horizontal=True,
        key="github_workspace_mode",
    )

    if workspace == "Overview":
        render_github_overview(github_token, owner_input, repo_input, org_input)
    elif workspace == "Activity Studio":
        render_github_activity_studio(github_token, owner_input, repo_input)
    elif workspace == "Team Studio":
        render_github_team_studio(github_token, owner_input, repo_input, org_input)
    else:
        render_github_console(github_token, owner_input, repo_input, org_input)


def main() -> None:
    st.set_page_config(page_title="DevTrack API Workbench", layout="wide")
    load_environment()
    inject_global_styles()

    st.markdown(
        """
        <div class='devtrack-card'>
            <div class='devtrack-section-title'>DevTrack Operations Workbench</div>
            <div class='devtrack-subtle'>
                Unified Jira and GitHub control center with guided studios, portfolio dashboards,
                and advanced API consoles for complete endpoint coverage.
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    with st.sidebar:
        st.markdown("### Control Panel")
        st.caption("Environment-backed credentials are loaded from .env")
        st.write("Jira profiles detected:", len(collect_jira_profiles()))
        st.write("GitHub token:", "Configured" if env_value("GITHUB_TOKEN") else "Missing")
        st.divider()
        st.caption("Tip: use Advanced Console modes for any endpoint not covered in guided studios.")

    jira_tab, github_tab = st.tabs(["Jira", "GitHub"])

    with jira_tab:
        render_jira_tab()

    with github_tab:
        render_github_tab()


if __name__ == "__main__":
    main()
