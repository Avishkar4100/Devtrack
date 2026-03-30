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


def render_jira_tab() -> None:
    st.subheader("Jira REST API Console")
    st.caption("Credentials are loaded from your .env file.")

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
    templates = jira_operation_templates(project_key=project_key)

    def jira_request_executor(
        operation: dict[str, Any],
        endpoint: str,
        query_payload: dict[str, Any] | None,
        body_payload: Any,
        prepared_files: list[tuple[str, tuple[str, bytes, str]]] | None,
    ) -> None:
        headers = {"Accept": "application/json"}
        headers.update(operation.get("extra_headers", {}))

        try:
            response = call_api(
                base_url=profile["base_url"],
                method=operation["method"],
                endpoint=endpoint,
                headers=headers,
                params=query_payload,
                body=body_payload,
                auth=(profile["email"], profile["token"]),
                files=prepared_files,
            )
            render_response(response)
        except httpx.RequestError as exc:
            st.error(f"Request failed: {exc}")

    render_operation_runner(
        scope_key="jira",
        templates=templates,
        request_executor=jira_request_executor,
    )

    with st.expander("Custom Jira Request", expanded=False):
        st.write("Use this for Jira endpoints not listed in templates.")

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
                return
            if body_payload == INVALID_JSON:
                st.error("Request body JSON is invalid.")
                return

            headers = {"Accept": "application/json"}
            files_payload = upload_payload(custom_files)
            if files_payload:
                headers["X-Atlassian-Token"] = "no-check"

            body_to_send = body_payload
            if method == "GET" and body_to_send == {}:
                body_to_send = None

            try:
                response = call_api(
                    base_url=profile["base_url"],
                    method=method,
                    endpoint=endpoint,
                    headers=headers,
                    params=clean_query,
                    body=body_to_send,
                    auth=(profile["email"], profile["token"]),
                    files=files_payload,
                )
                render_response(response)
            except httpx.RequestError as exc:
                st.error(f"Request failed: {exc}")


def render_github_tab() -> None:
    st.subheader("GitHub REST API Console")
    st.caption("Credentials are loaded from your .env file.")

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
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {github_token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

        try:
            response = call_api(
                base_url="https://api.github.com",
                method=operation["method"],
                endpoint=endpoint,
                headers=headers,
                params=query_payload,
                body=body_payload,
                auth=None,
                files=prepared_files,
            )
            render_response(response)
        except httpx.RequestError as exc:
            st.error(f"Request failed: {exc}")

    render_operation_runner(
        scope_key="github",
        templates=templates,
        request_executor=github_request_executor,
    )

    with st.expander("Custom GitHub Request", expanded=False):
        st.write("Use this for any GitHub endpoint not listed in templates.")

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
                return
            if body_payload == INVALID_JSON:
                st.error("Request body JSON is invalid.")
                return

            body_to_send = body_payload
            if method == "GET" and body_to_send == {}:
                body_to_send = None

            headers = {
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {github_token}",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            try:
                response = call_api(
                    base_url="https://api.github.com",
                    method=method,
                    endpoint=endpoint,
                    headers=headers,
                    params=clean_query,
                    body=body_to_send,
                    auth=None,
                    files=None,
                )
                render_response(response)
            except httpx.RequestError as exc:
                st.error(f"Request failed: {exc}")


def main() -> None:
    st.set_page_config(page_title="DevTrack API Workbench", layout="wide")
    load_environment()

    st.title("DevTrack API Workbench")
    st.write(
        "This Streamlit app uses credentials from .env and provides two tabs: Jira and GitHub."
    )

    jira_tab, github_tab = st.tabs(["Jira", "GitHub"])

    with jira_tab:
        render_jira_tab()

    with github_tab:
        render_github_tab()


if __name__ == "__main__":
    main()
