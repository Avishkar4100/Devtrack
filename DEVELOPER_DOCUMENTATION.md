# DevTrack — Complete Developer Documentation

> **Audience:** New and existing developers who will maintain/extend this codebase for the next 5 years.  
> **Generated:** 2026-06-27  
> **Version:** v1.2.0  
> **Commit:** 41abdc4

---

## Table of Contents

1. [Project Overview & Business Purpose](#1-project-overview--business-purpose)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Architecture Diagram (ASCII)](#3-architecture-diagram-ascii)
4. [Folder Structure Deep Dive](#4-folder-structure-deep-dive)
5. [Execution Flow: Request to Response](#5-execution-flow-request-to-response)
6. [Frontend Deep Dive](#6-frontend-deep-dive)
7. [Backend Deep Dive](#7-backend-deep-dive)
8. [AI Service Deep Dive](#8-ai-service-deep-dive)
9. [Database Schema & ER Diagram](#9-database-schema--er-diagram)
10. [API Catalog & Workflows](#10-api-catalog--workflows)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [External Integrations](#12-external-integrations)
13. [State Management](#13-state-management)
14. [Design Patterns](#14-design-patterns)
15. [Important Algorithms](#15-important-algorithms)
16. [Configuration & Environment Variables](#16-configuration--environment-variables)
17. [Dependencies](#17-dependencies)
18. [Error Handling & Logging](#18-error-handling--logging)
19. [Security Analysis](#19-security-analysis)
20. [Performance Bottlenecks](#20-performance-bottlenecks)
21. [Code Quality & Technical Debt](#21-code-quality--technical-debt)
22. [Scalability Concerns](#22-scalability-concerns)
23. [Deployment Process](#23-deployment-process)
24. [Testing Strategy](#24-testing-strategy)
25. [Module Dependency Graph](#25-module-dependency-graph)
26. [Sequence Diagrams](#26-sequence-diagrams)
27. [Hidden Assumptions & Common Pitfalls](#27-hidden-assumptions--common-pitfalls)
28. [Prioritized Improvement Roadmap](#28-prioritized-improvement-roadmap)

---

## 1. Project Overview & Business Purpose

**DevTrack** is an AI-powered IT project management platform that bridges the gap between Software Requirements Specifications (SRS) and actual Jira backlog creation. It solves a real business problem: **PMs and Scrum Masters spend 8-20 hours manually converting SRS documents into Jira epics/stories/tasks.** DevTrack automates this using LLM-powered generation with RAG (Retrieval Augmented Generation) grounded in uploaded documents.

**Core Value Proposition:**
- Upload an SRS document (PDF/DOCX/TXT) → AI extracts structured requirements
- AI suggests planning paths based on gap analysis between SRS requirements and current project state
- AI generates a Jira-ready hierarchical backlog (Epic → Story → Task → Subtask)
- One-click push to Jira with proper parent-child mapping
- GitHub integration for commit-to-story traceability (code evidence against acceptance criteria)
- Real-time collaboration via Socket.io

**Target Users:** Scrum Masters, Product Managers, Engineering Managers, Developers

---

## 2. High-Level Architecture

DevTrack follows a **Three-Tier Microservices Architecture** with a shared MongoDB Atlas database:

```
┌──────────────────────────────────────────────────────────────┐
│                     USER'S BROWSER                           │
│  React 18 SPA (Vite) + Tailwind CSS + Zustand + Socket.io   │
└──────────┬──────────────────────────────────────┬───────────┘
           │ HTTP/REST + WebSocket                │
           ▼                                      ▼
┌──────────────────────┐              ┌─────────────────────────┐
│   BACKEND (Node.js)  │───HTTP──────▶│   AI SERVICE (Python)   │
│   Express 4          │              │   FastAPI + ChromaDB    │
│   Port 5000          │◀─────────────│   Port 8000             │
│   Socket.io          │              │   LangChain + OpenAI    │
└──────────┬───────────┘              └───────────┬─────────────┘
           │                                      │
           ▼                                      ▼
┌──────────────────────┐              ┌─────────────────────────┐
│   MongoDB Atlas      │              │   ChromaDB (Local)      │
│   (Shared Database)  │              │   Vector Embeddings     │
└──────────────────────┘              └─────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│              EXTERNAL APIS                                   │
│  Jira REST API v3  │  GitHub REST API  │  OpenRouter/DeepSeek│
│  AbstractAPI Email │  SMTP (Resend)    │  Google/GitHub OAuth│
└──────────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**
1. **Backend is the orchestrator** — it never lets the frontend talk directly to the AI service. All AI calls go through the backend Node.js layer, which enriches context from MongoDB before forwarding to the Python AI service.
2. **AI Service is stateless** — it has no database of its own beyond ChromaDB for vector storage. All business data lives in MongoDB.
3. **Both services share the same MongoDB** — the AI service reads documents from MongoDB for requirement extraction (though primary CRUD happens through the backend).
4. **Mock fallbacks exist only at the very edge** — suggestion/generation failures propagate errors, not mock data, to the UI (the README's "mock fallback" claim is outdated; the current code only has mock data in `aiService.js` as dead code).
5. **Vector search uses locally-stored ChromaDB** with ONNX-based embeddings, not a paid vector DB service.

---

## 3. Architecture Diagram (ASCII)

```
                    REQUEST/RESPONSE FLOW

FRONTEND (React SPA)
│
│  App.jsx (React Router)
│  ├── /                    → Home.jsx
│  ├── /login               → Login.jsx
│  ├── /register            → Register.jsx
│  ├── /verify-email        → VerifyEmail.jsx
│  ├── /reset-password/:tok → ResetPassword.jsx
│  ├── /auth/callback       → AuthCallback.jsx (OAuth)
│  ├── /dashboard           → Dashboard.jsx
│  ├── /projects            → Projects.jsx
│  ├── /projects/:id        → ProjectDetail.jsx
│  │   ├── /workspace       → ProjectWorkspace.jsx
│  │   │   ├── /planner     → AIPlanner.jsx
│  │   │   └── /backlog     → BacklogEditor.jsx
│  │   ├── /documents       → Documents.jsx
│  │   ├── /stories         → Stories.jsx
│  │   ├── /sprints         → Sprints.jsx
│  │   ├── /insights        → Insights.jsx
│  │   ├── /jira            → JiraControl.jsx
│  │   └── /settings        → Settings.jsx (overview)
│  ├── /admin               → AdminLogin.jsx
│  │   ├── /overview        → AdminOverview.jsx
│  │   ├── /projects        → AdminProjects.jsx
│  │   ├── /organizations   → AdminOrganizations.jsx
│  │   ├── /ai-config       → AdminAIConfig.jsx
│  │   └── /control         → AdminControl.jsx
│  └── /workspace           → Workspace.jsx
│
│  State: authStore, projectStore, workspaceStateStore,
│         notificationStore, themeStore, manualBridgeStore
│
▼
BACKEND (Express.js :5000)
│
│  server.js
│  ├── Security: helmet, cors, rate-limit, mongo-sanitize, hpp
│  ├── Logging: morgan → winston
│  ├── Socket.io: project-room based events
│  │
│  ├── /api/auth/*       → authRoutes + authLimiter
│  │   └── authController (register, login, OAuth, OTP verify)
│  ├── /api/projects/*   → projectRoutes
│  │   └── projectController (CRUD, invite, audit, users)
│  ├── /api/documents/*  → documentRoutes
│  │   └── documentController (upload, ingest, reingest)
│  ├── /api/stories/*    → storyRoutes
│  │   └── storyController (suggest, generate, save, CRUD)
│  ├── /api/jira/*       → jiraRoutes
│  │   └── jiraController (test, push, sync)
│  ├── /api/github/*     → githubRoutes
│  │   └── githubController (connect, analyze)
│  ├── /api/sprints/*    → sprintRoutes
│  │   └── sprintController (CRUD, activate, complete)
│  ├── /api/dashboard/*  → dashboardRoutes
│  ├── /api/insights/*   → insightRoutes
│  ├── /api/admin/*      → adminRoutes
│  └── /api/manual-bridge/* → manualBridgeRoutes
│
│  Services Layer:
│  ├── aiService.js          → HTTP bridge to AI service
│  ├── aiConfigService.js    → Admin AI provider config
│  ├── aiUsageService.js     → Track AI token usage/costs
│  ├── documentService.js    → Document parsing helpers
│  ├── email.js              → SMTP email templates
│  ├── githubValidator.js    → GitHub repo validation
│  ├── insightService.js     → Standup/insight generation
│  ├── projectStateManager.js→ Build project state snapshots
│  ├── reExtractionService.js→ Re-run requirement extraction
│  ├── socketService.js      → WebSocket event emitters
│  ├── sprintService.js      → Sprint auto-closure logic
│  └── workspaceBootstrapService.js → New user setup
│
▼
AI SERVICE (FastAPI :8000)
│
│  main.py
│  ├── /documents/*     → documents router
│  │   └── ingest, parse, chunk, embed into ChromaDB
│  ├── /stories/*       → stories router
│  │   ├── /suggest          → planner path suggestions
│  │   ├── /discover-gaps    → gap analysis vs SRS
│  │   ├── /generate         → hierarchical backlog gen
│  │   ├── /extract-requirements → SRS → structured reqs
│  │   ├── /chunks-by-ids    → targeted RAG retrieval
│  │   ├── /chunks-by-refs   → exact chunk retrieval
│  │   └── /standup-summary  → LLM test endpoint
│  ├── /github/*        → github_analysis router
│  │   └── /analyze          → code diff vs story AC
│  ├── /jira/*          → jira router
│  │   └── /summary          → Jira project summary
│  └── /manual-bridge/* → manual_bridge router
│
│  Services:
│  ├── llm_service.py        → All LLM calls (OpenRouter/DeepSeek)
│  ├── rag_service.py        → ChromaDB vector retrieval
│  ├── embeddings.py         → ONNX embedding model wrapper
│  ├── document_parser.py    → Basic doc parsing (txt/pdf/docx)
│  └── enhanced_document_parser.py → Magic-byte validation
│
▼
DATA LAYER
│
├── MongoDB Atlas (shared)
│   Collections: User, Project, Story, Epic, Document,
│                 Requirement, Sprint, Commit, AuditLog,
│                 AIConfig, AIUsageLog, BacklogHistory,
│                 Organization
│
└── ChromaDB (local, ./chroma_store/)
    └── Collections per project: {project_id}_chunks
        └── Documents: text chunks + metadata (requirement_id)
```

---

## 4. Folder Structure Deep Dive

```
AI--POWERD-DEVTRACK/
│
├── backend/                          # Node.js Express API Server
│   ├── server.js                     # ★ ENTRY POINT: Express app bootstrap, middleware, routes, Socket.io, graceful shutdown
│   ├── package.json                  # Node dependencies
│   ├── .env.example                  # Template for required env vars
│   ├── test-*.js                     # Ad-hoc test scripts (not a formal test suite)
│   ├── scripts/                      # Utility scripts
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js                 # MongoDB connection with SRV fallback logic
│   │   │   ├── logger.js             # Winston logger (console transport)
│   │   │   └── jobs.js               # Cron-like scheduled jobs (sprint auto-closure)
│   │   ├── controllers/              # ★ BUSINESS LOGIC: One controller per domain
│   │   │   ├── authController.js     # Register, login, OTP, OAuth (GitHub/Google), password reset
│   │   │   ├── projectController.js  # Project CRUD, member management, audit log
│   │   │   ├── storyController.js    # ★ LARGEST FILE (1290 lines): Suggest, generate, save, CRUD, bulk-assign
│   │   │   ├── documentController.js # Upload, ingest/status, re-extraction
│   │   │   ├── jiraController.js     # Test connection, push backlog hierarchy to Jira
│   │   │   ├── githubController.js   # Connect repo, analyze commits vs stories
│   │   │   ├── sprintController.js   # Sprint CRUD, activate, complete with auto-assignment
│   │   │   ├── dashboardController.js# Aggregated stats for dashboard
│   │   │   ├── insightController.js  # AI-powered project insights
│   │   │   ├── adminController.js    # Admin panel: projects, orgs, AI config, control
│   │   │   └── manualBridgeController.js # WebSocket-based manual data bridge
│   │   ├── middleware/
│   │   │   ├── auth.js               # JWT verification + role-based authorization
│   │   │   └── error.js              # Global error handler + 404 handler
│   │   ├── models/                   # ★ MONGOOSE SCHEMAS
│   │   │   ├── User.js               # Users with bcrypt, JWT methods, OAuth fields, integration tokens
│   │   │   ├── Project.js            # Projects with Jira/GitHub connection state
│   │   │   ├── Story.js              # ★ CORE ENTITY: Stories/tasks/subtasks with code evidence
│   │   │   ├── Epic.js               # Epics with completion tracking
│   │   │   ├── Document.js           # Uploaded SRS documents with ingestion status
│   │   │   ├── Requirement.js        # Extracted structured requirements
│   │   │   ├── Sprint.js             # Sprints with S1-S4 workflow
│   │   │   ├── Commit.js             # GitHub commit records
│   │   │   ├── AuditLog.js           # Immutable audit trail
│   │   │   ├── BacklogHistory.js     # Saved backlog generation history
│   │   │   ├── AIConfig.js           # Admin AI provider configuration
│   │   │   ├── AIUsageLog.js         # AI token usage tracking
│   │   │   └── Organization.js       # Multi-tenant organization scaffolding
│   │   ├── routes/                   # ★ EXPRESS ROUTERS (thin, delegate to controllers)
│   │   │   ├── auth.js, projects.js, stories.js, documents.js,
│   │   │   ├── jira.js, github.js, sprints.js, dashboard.js,
│   │   │   ├── insightRoutes.js, admin.js, manualBridge.js
│   │   ├── services/                 # ★ BUSINESS LOGIC SERVICES
│   │   │   ├── aiService.js          # HTTP bridge to Python AI service (axios)
│   │   │   ├── aiConfigService.js    # Get active AI provider config from DB
│   │   │   ├── aiUsageService.js     # Log AI usage to MongoDB
│   │   │   ├── documentService.js    # Document metadata helpers
│   │   │   ├── email.js              # SMTP email templates (Resend/SMTP)
│   │   │   ├── githubValidator.js    # Validate GitHub repos/branches
│   │   │   ├── insightService.js     # Generate standup summaries
│   │   │   ├── projectStateManager.js# Build holistic project state snapshots
│   │   │   ├── reExtractionService.js# Re-run SRS extraction
│   │   │   ├── socketService.js      # Typed Socket.io event emitters
│   │   │   ├── sprintService.js      # Sprint auto-closure business logic
│   │   │   └── workspaceBootstrapService.js # Initialize new user workspace
│   │   └── utils/
│   │       ├── aiServiceUrl.js       # Resolve AI service URL with retry logic
│   │       └── errorUtils.js         # Client-safe error message extraction
│
├── frontend/                         # React 18 SPA (Vite)
│   ├── index.html                    # HTML entry point
│   ├── vite.config.js                # Vite config with proxy to backend
│   ├── tailwind.config.js            # Tailwind CSS (dark theme)
│   ├── postcss.config.js             # PostCSS config
│   ├── package.json                  # Frontend dependencies
│   ├── public/                       # Static assets
│   ├── src/
│   │   ├── main.jsx                  # ★ ENTRY POINT: ReactDOM.render + providers
│   │   ├── App.jsx                   # ★ ROUTER: React Router v6 route definitions
│   │   ├── index.css                 # Tailwind directives + global styles
│   │   ├── polyfills.js              # Browser polyfills
│   │   ├── components/               # ★ REUSABLE UI COMPONENTS
│   │   │   ├── Layout.jsx            # Main app shell (sidebar, topbar, content area)
│   │   │   ├── AdminLayout.jsx       # Admin panel shell
│   │   │   ├── ConfirmDialog.jsx     # Reusable confirmation modal
│   │   │   ├── NotificationSync.jsx  # Toast notification collector → bell history
│   │   │   ├── ThemeSync.jsx         # Dark/light mode sync with localStorage
│   │   │   ├── RequestTerminal.jsx   # Debug/dev request viewer
│   │   │   ├── AppErrorBoundary.jsx  # Top-level React error boundary
│   │   │   ├── DataErrorBoundary.jsx # Data-fetching error boundary with retry
│   │   │   └── PageErrorBoundary.jsx # Per-page error boundary
│   │   ├── pages/                    # ★ ROUTE-LEVEL PAGE COMPONENTS
│   │   │   ├── Home.jsx, Login.jsx, Register.jsx, VerifyEmail.jsx
│   │   │   ├── ResetPassword.jsx, AuthCallback.jsx
│   │   │   ├── Dashboard.jsx, Projects.jsx, ProjectDetail.jsx
│   │   │   ├── ProjectWorkspace.jsx  # Tabbed workspace (Planner/Backlog)
│   │   │   ├── AIPlanner.jsx         # ★ COMPLEX: SRS ingestion, planning context, suggestion, generation
│   │   │   ├── BacklogEditor.jsx     # ★ COMPLEX: Tree hierarchy editor, inline editing, Jira push
│   │   │   ├── Documents.jsx, Stories.jsx, Sprints.jsx
│   │   │   ├── Insights.jsx, JiraControl.jsx, Settings.jsx
│   │   │   ├── Workspace.jsx, Overview.jsx
│   │   │   └── Admin*.jsx            # Admin panel pages
│   │   ├── store/                    # ★ ZUSTAND STATE STORES
│   │   │   ├── authStore.js          # Auth state (user, token, login/logout actions)
│   │   │   ├── projectStore.js       # Active project context
│   │   │   ├── workspaceStateStore.js# Planner/workspace draft persistence
│   │   │   ├── notificationStore.js  # Toast history with seen/unseen tracking
│   │   │   ├── themeStore.js         # Dark/light mode preference
│   │   │   └── manualBridgeStore.js  # Manual bridge data state
│   │   └── lib/                      # ★ UTILITIES & API CLIENTS
│   │       ├── api.js                # ★ Axios instance with interceptors (auth token, error handling)
│   │       ├── socket.js             # Socket.io client singleton
│   │       ├── useProjectSocket.js   # React hook for project-room socket events
│   │       ├── utils.js              # General utility functions
│   │       ├── logger.js             # Frontend logger
│   │       └── errorUtils.js         # Client error utilities
│
├── ai-service/                       # Python FastAPI Microservice
│   ├── main.py                       # ★ ENTRY POINT: FastAPI app, CORS, routers, health checks
│   ├── requirements.txt              # Python dependencies
│   ├── .env.example                  # Template for AI service env vars
│   ├── test_chroma_health.py         # ChromaDB health check script
│   ├── routers/                      # ★ FASTAPI ROUTERS
│   │   ├── stories.py                # Story generation, suggestion, extraction, gap discovery
│   │   ├── documents.py              # Document ingestion (parse → chunk → embed → store)
│   │   ├── github_analysis.py        # Code diff analysis vs acceptance criteria
│   │   ├── jira.py                   # Jira project summary analysis
│   │   └── manual_bridge.py          # WebSocket/manual data bridge
│   ├── services/                     # ★ AI BUSINESS LOGIC
│   │   ├── llm_service.py            # ★ 1675 lines: All LLM interactions, prompt templates, response parsing
│   │   ├── rag_service.py            # ChromaDB retrieval (similarity, by IDs, by refs)
│   │   ├── embeddings.py             # ONNX embedding model (all-MiniLM-L6-v2)
│   │   ├── document_parser.py        # Basic document text extraction
│   │   ├── enhanced_document_parser.py # Magic byte validation, structured parsing
│   │   └── manual_bridge_service.py  # Manual bridge data processing
│   └── chroma_store/                 # ★ PERSISTENT VECTOR DATABASE
│       └── {uuid}/                   # ChromaDB internal structure
│
├── README.md                         # Quick start guide
├── PROJECT_BLUEPRINT.html            # Architectural blueprint
├── CURRENT_PROMPT_TEMPLATES.md       # All 11 LLM prompt templates
├── DEPLOYMENT_NOTES_v1.2.0.md        # Dark mode release notes
├── EMAIL_ASSIGNMENT_GUIDE.md         # Email notification setup
├── GITHUB_VALIDATION_GUIDE.md        # GitHub integration setup
├── WEBSOCKET_REALTIME.md             # WebSocket event documentation
├── package.json                      # Root package.json (convenience scripts)
└── .gitignore                        # Git ignore rules
```

---

## 5. Execution Flow: Request to Response

### 5.1 Primary Flow: SRS Upload → AI Suggestion → Backlog Generation → Jira Push

```
USER ACTION                   SYSTEM RESPONSE
────────────                  ────────────────
1. User logs in
   POST /api/auth/login       → JWT token returned, stored in localStorage
                              → authStore updated, user redirected to dashboard

2. User creates a project
   POST /api/projects         → Backend validates Jira key + GitHub repo existence
                              → Project created with jiraProjectKey, githubRepo
                              → AuditLog entry created

3. User uploads SRS document
   POST /api/documents/upload/:projectId
                              → File saved to backend/uploads/
                              → Document record created (status: 'uploaded')
                              → Backend calls aiService.ingestDocument()
                                → AI service parses file (PDF/DOCX/TXT)
                                → Text chunked into ~500-token segments
                                → Each chunk embedded via ONNX model
                                → Stored in ChromaDB with project_id namespace
                              → Document status updated to 'processing' → 'processed'
                              → Backend calls aiService.extractRequirements()
                                → LLM extracts functional/non-functional requirements
                                → Stored as Requirement document in MongoDB
                              → Socket.io emits 'document:status' event

4. User opens AI Planner
   GET /api/stories/project-state/:projectId
                              → Backend builds comprehensive project state snapshot
                                (requirements, stories, commits, sprints, epics)
                              → Used to initialize planner context

5. User clicks "Suggest" for a module
   POST /api/stories/suggest/:projectId
                              → Backend builds vectorless context graph
                              → Calls aiService.discoverGaps()
                                → AI service compares requirement map vs project state
                                → Returns planning paths with requirement IDs
                              → Calls aiService.getChunksByIds()
                                → Retrieves exact SRS chunks for discovered requirements
                              → Calls aiService.suggestStories()
                                → LLM generates epics/stories/tasks suggestions
                                → Grounded in retrieved SRS chunks
                              → Returns normalized planning paths to UI

6. User selects planning paths, clicks "Generate Backlog"
   POST /api/stories/generate/:projectId
                              → Backend builds rich context:
                                - Requirement map items
                                - Requirement graph items
                                - Project state snapshot
                                - Team members
                                - Selected paths/chunks
                              → Calls aiService.generateStories()
                                → AI service retrieves chunks by refs/IDs/similarity
                                → LLM generates hierarchical backlog JSON
                              → BacklogHistory record created
                              → Returns backlog JSON to UI

7. User edits backlog in BacklogEditor, clicks "Save"
   POST /api/stories/save/:projectId
                              → Backend validates hierarchy (parent references)
                              → Creates Epic documents
                              → Creates Story documents with proper parent linkage
                              → Updates project completion counts
                              → Socket.io emits 'stories:saved'

8. User clicks "Push to Jira"
   POST /api/jira/push/:projectId
                              → Backend pushes epics first, gets Jira keys
                              → Pushes stories/tasks with parent references to Jira keys
                              → Maps local IDs ↔ Jira keys
                              → Updates Story documents with jiraIssueId/jiraIssueKey
```

### 5.2 Secondary Flow: GitHub Code Analysis

```
9. User connects GitHub repo
   POST /api/github/connect/:projectId
                              → Backend validates repo access with user's GitHub token
                              → Sets project.githubConnected = true

10. User triggers code analysis
    POST /api/github/analyze/:projectId
                              → Backend fetches recent commits from GitHub API
                              → For each story, calls aiService.analyzeCode()
                                → AI service compares code diff against acceptance criteria
                                → Returns status (done/partial/not_started) + evidence
                              → Story.codeEvidence updated with file paths/lines
                              → Story.codeStatus updated
```

---

## 6. Frontend Deep Dive

### 6.1 Technology Stack
- **React 18** with functional components and hooks
- **Vite** build tool (fast HMR, ESBuild)
- **Tailwind CSS** with custom dark theme (dark backgrounds: `#1a1a1a`, `#242424`, `#1e1e1e`)
- **Zustand** for state management (with `persist` middleware for localStorage)
- **TanStack Query (React Query)** for server state
- **React Router v6** for client-side routing
- **Recharts** for burndown/progress charts
- **Framer Motion** for animations
- **Socket.io Client** for real-time events
- **Axios** for HTTP requests

### 6.2 Routing Structure (App.jsx)

The app uses React Router v6 with nested routes:

```
<BrowserRouter>
  <Routes>
    {/* Public routes */}
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/reset-password/:token" element={<ResetPassword />} />
    <Route path="/auth/callback" element={<AuthCallback />} />

    {/* Protected user routes (Layout wrapper) */}
    <Route element={<Layout />}>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/projects/:id" element={<ProjectDetail />}>
        <Route path="workspace" element={<ProjectWorkspace />}>
          <Route path="planner" element={<AIPlanner />} />
          <Route path="backlog" element={<BacklogEditor />} />
        </Route>
        <Route path="documents" element={<Documents />} />
        <Route path="stories" element={<Stories />} />
        <Route path="sprints" element={<Sprints />} />
        <Route path="insights" element={<Insights />} />
        <Route path="jira" element={<JiraControl />} />
        <Route index element={<Overview />} />
      </Route>
      <Route path="/settings" element={<Settings />} />
      <Route path="/workspace" element={<Workspace />} />
    </Route>

    {/* Admin routes (AdminLayout wrapper) */}
    <Route path="/admin" element={<AdminLogin />} />
    <Route path="/admin" element={<AdminLayout />}>
      <Route path="overview" element={<AdminOverview />} />
      <Route path="projects" element={<AdminProjects />} />
      <Route path="organizations" element={<AdminOrganizations />} />
      <Route path="ai-config" element={<AdminAIConfig />} />
      <Route path="control" element={<AdminControl />} />
    </Route>
  </Routes>
</BrowserRouter>
```

### 6.3 State Management Architecture

```
ZUSTAND STORES (with persist middleware where noted)
│
├── authStore.js           [PERSISTED to localStorage]
│   State: user, token, isAuthenticated, isAdmin
│   Actions: login(), register(), logout(), updateProfile(), updateIntegrations()
│   Used By: api.js (interceptor reads token), Layout.jsx, Login.jsx, Register.jsx
│
├── projectStore.js        [PERSISTED to localStorage]
│   State: activeProject, projects[]
│   Actions: setActiveProject(), fetchProjects()
│   Used By: ProjectWorkspace.jsx, AIPlanner.jsx, BacklogEditor.jsx
│
├── workspaceStateStore.js [PERSISTED to localStorage]
│   State: plannerDraft { moduleName, userInput, selectedPaths, contextRefs }
│   Actions: savePlannerDraft(), clearPlannerDraft()
│   Purpose: Survives page refreshes during planning workflow
│   Cleared: on logout
│
├── notificationStore.js   [PERSISTED to localStorage]
│   State: notifications[] { id, type, message, timestamp, seen }
│   Actions: addNotification(), markSeen(), markAllSeen(), clearAll()
│   Used By: NotificationSync.jsx (toast→history), Layout.jsx (bell popup)
│
├── themeStore.js          [PERSISTED to localStorage]
│   State: theme ('light' | 'dark')
│   Actions: toggleTheme()
│   Used By: ThemeSync.jsx (applies 'dark' class to <html>)
│
└── manualBridgeStore.js
    State: bridgeData, pendingSnapshots
    Actions: syncData(), clearPending()
```

### 6.4 API Client (api.js)

The centralized `api.js` is an Axios instance with:

```javascript
// Base configuration
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attaches JWT Bearer token from authStore
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: handles 401 (auto-logout), normalizes errors
api.interceptors.response.use(
  (response) => response.data,  // ★ Unwraps response.data automatically
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

**Important:** All API calls in page components call `api.get('/projects')` and receive the response body directly (not `response.data`). This is because the interceptor already unwraps it.

### 6.5 Most Complex Pages

#### AIPlanner.jsx (SRS Upload → Planning → Generation workflow)
- **Tabs:** Planner Tab (SRS ingestion, planning prompt, suggestions, generate) + Backlog Tab
- **State:** Uses workspaceStateStore to persist planning context across navigation
- **Flow:** Upload SRS → Wait for ingestion → Build planning context → Suggest → Select paths → Generate
- **Dark mode:** Fully styled with dark backgrounds (`#1a1a1a`, `#242424`, `#1e3a5f`)

#### BacklogEditor.jsx (Tree hierarchy editor)
- **Tree structure:** Epic → Story → Task → Subtask hierarchy
- **Features:** Add/delete/re-parent items, inline field editing, validation
- **Actions:** Save to MongoDB, Push to Jira
- **State:** Operates on generated backlog JSON before persistence

---

## 7. Backend Deep Dive

### 7.1 Server Bootstrap (server.js)

```
1. Load .env via dotenv
2. Import all route modules
3. Connect to MongoDB (connectDB)
4. Create Express app
5. Configure middleware (order matters):
   a. Request ID assignment (UUID)
   b. Security: helmet, CORS, compression, mongoSanitize, hpp
   c. Body parsing: express.json (50MB limit), express.urlencoded
   d. Rate limiting: global limiter on /api, authLimiter on /api/auth
   e. Logging: morgan → winston
   f. Static files: /uploads
6. Define routes:
   - /health (public, no rate limit)
   - /api/auth (with authLimiter)
   - /api/projects, /api/documents, /api/stories, /api/jira, /api/github,
     /api/dashboard, /api/sprints, /api/insights, /api/admin, /api/manual-bridge
7. Create HTTP server, attach Socket.io
8. Configure Socket.io connection handling (join/leave project rooms)
9. Error handling middleware (notFound, errorHandler)
10. Start listening on PORT (default 5000)
11. Initialize scheduled jobs (sprint auto-closure)
12. Register process handlers (unhandledRejection, uncaughtException, SIGTERM)
```

### 7.2 Middleware Stack (Order of Execution)

```
Request
  │
  ├── 1. Request ID middleware         (adds req.requestId, sets x-request-id header)
  ├── 2. Helmet                        (security headers)
  ├── 3. CORS                          (origin check: localhost:5173-5176 or FRONTEND_URL)
  ├── 4. Compression                   (gzip response compression)
  ├── 5. mongoSanitize                 (prevents MongoDB operator injection)
  ├── 6. hpp                           (prevents HTTP parameter pollution)
  ├── 7. express.json({ limit: '50mb' }) (body parsing)
  ├── 8. express.urlencoded            (form data parsing)
  ├── 9. Rate limiter                  (global: 500 req/15min, auth: 10 req/15min)
  ├── 10. Morgan → Winston logger      (request logging)
  ├── 11. Route matching               (starts with /api/*)
  │     └── authLimiter (only /api/auth)
  ├── 12. Route handler
  │     └── protect middleware (JWT verification on protected routes)
  │         └── authorize middleware (role check)
  │             └── Controller method
  ├── 13. 404 handler                  (notFound middleware)
  └── 14. Global error handler         (errorHandler middleware)
```

### 7.3 Authentication Flow

```
REGISTER:
  Email + Password → validate fields → check AbstractAPI (email deliverability)
  → check duplicate → create User (isEmailVerified: false)
  → generate 6-digit OTP → send OTP email → return requiresVerification: true

VERIFY EMAIL:
  Email + OTP → find User → validate OTP (match + expiry)
  → set isEmailVerified: true → generate JWT → return token + user

LOGIN:
  Email + Password → find User (+password) → bcrypt.compare
  → auto-verify if password correct → generate JWT → return token + user

OAUTH (GitHub/Google):
  Redirect to provider → callback → exchange code for token
  → fetch user profile → create/find User → generate JWT
  → redirect to frontend /auth/callback?token=...&user=...

JWT STRUCTURE:
  { id: user._id, role: user.role } signed with JWT_SECRET
  Expiry: JWT_EXPIRE (default 7d)

ROLES (after normalizeRole in auth middleware):
  - 'admin'       → Full platform access
  - 'scrum_master'→ Can create/manage projects, generate stories, push to Jira
  - 'manager'     → Standard user (product_manager, developer, designer all map to this)
```

### 7.4 Database Connection (db.js)

The MongoDB connection has a sophisticated fallback mechanism:
```
1. Try MONGO_URI (mongodb+srv:// format)
2. If SRV DNS lookup fails (common on restricted networks):
   → Try MONGO_URI_DIRECT or MONGO_URI_FALLBACK (direct mongodb:// format)
3. Connection options: serverSelectionTimeoutMS: 10000
4. Event listeners for 'disconnected' and 'reconnected'
```

### 7.5 Scheduled Jobs (jobs.js)

Only one scheduled job exists:
- **Sprint auto-closure:** Runs hourly, checks for sprints past their endDate with status 'active', auto-closes them and moves incomplete stories to the next sprint or backlog.

---

## 8. AI Service Deep Dive

### 8.1 LLM Service (llm_service.py — 1675 lines)

This is the most complex service. It supports three AI providers:

```
PROVIDER RESOLUTION LOGIC:
1. Check ai_config payload from admin settings (AIConfig collection)
2. If provider = 'openrouter' → use OpenRouter API (OpenAI-compatible)
3. If provider = 'deepseek_local' → use self-hosted DeepSeek (Ollama/vLLM)
4. If provider = 'deepseek_api' → use DeepSeek official API
5. Default: OpenRouter with google/gemini-2.0-flash-exp:free

MODEL FALLBACK CHAIN (for OpenRouter):
  openrouterModel → "google/gemini-2.0-flash-exp:free"
  
MODEL FALLBACK CHAIN (for DeepSeek):
  deepseekModel → "deepseek-chat"
```

**11 Prompt Templates** (see CURRENT_PROMPT_TEMPLATES.md for full text):

| # | Template Name | Purpose | Output |
|---|--------------|---------|--------|
| 1 | STORY_GENERATION_PROMPT | Generate Jira-ready backlog hierarchy | JSON with issues[] |
| 2 | CODE_ANALYSIS_PROMPT | Analyze code diff vs story acceptance criteria | JSON with status/evidence |
| 3 | JIRA_SUMMARY_PROMPT | Summarize Jira project state | JSON summary/risks/actions |
| 4 | PLANNER_SUGGEST_PROMPT | Generate planning suggestions from context graph | JSON epics/stories/tasks |
| 5 | REQUIREMENT_EXTRACTION_PROMPT | Extract structured requirements from SRS | JSON with FR/NFR/modules/actors |
| 6 | PHASE_ACTION_SUGGEST_PROMPT | Phase-aware gap analysis suggestions | JSON suggestions[] |
| 7 | STANDUP_SUMMARY_PROMPT | Generate standup summary | Plain text (3 sections) |
| 8 | _extract_technical_tasks | Extract actionable bullet tasks | Plain text bullets |
| 9 | _format_to_jira_schema | Convert bullets to Jira JSON | JSON array |
| 10 | _critic_review | QA review of generated Jira items | JSON approved/feedback |
| 11 | DISCOVERY_GAPS_PROMPT | Discover planning gaps from requirement graph | JSON paths[] |

### 8.2 RAG Pipeline

```
DOCUMENT INGESTION FLOW:
1. Upload file (PDF/DOCX/TXT)
2. EnhancedDocumentParser.parse_document()
   → Magic byte validation (checks actual file type, not extension)
   → Text extraction (PyPDF2 for PDF, python-docx for DOCX, direct read for TXT)
3. Text chunking (recursive character splitter, ~500 token chunks with overlap)
4. Embedding via EmbeddingService (ONNX all-MiniLM-L6-v2, 384 dimensions)
5. Store in ChromaDB collection: {project_id}_{namespace}_chunks
   → Metadata: requirement_id, chunk_index, source_file

RETRIEVAL FLOW (3-stage cascade):
Stage 1 (Exact): chunk_refs → collection.get(ids=[...])
Stage 2 (Targeted): requirement_ids → collection.query(where={"requirement_id": id})
Stage 3 (Similarity): module_name → embedding_service.query(query, top_k)
```

### 8.3 Embedding Model

- **Model:** all-MiniLM-L6-v2 (ONNX runtime)
- **Dimensions:** 384
- **Library:** `chromadb` with `onnxruntime` backend
- **Startup:** Model loaded once at first use (lazy initialization)
- **Telemetry:** Forced OFF (`ANONYMIZED_TELEMETRY=FALSE`)

### 8.4 Three-Step Generation (Advanced Flow)

The stories.py router implements an advanced three-step pipeline for Jira-formatted output:
1. **Brain Step** (`_extract_technical_tasks`): LLM extracts concrete technical tasks as bullets
2. **Secretary Step** (`_format_to_jira_schema`): LLM converts bullets to Jira JSON schema
3. **Critic Step** (`_critic_review`): LLM reviews output for coverage, specificity, testability

However, this three-step pipeline appears to be **available but not currently wired into the main generate endpoint**. The main `/stories/generate` endpoint uses the single-call `STORY_GENERATION_PROMPT` template. This is a **code quality issue** — dead advanced code.

---

## 9. Database Schema & ER Diagram

### 9.1 Entity-Relationship Diagram

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   User       │       │ Organization │       │  AIConfig    │
│──────────────│       │──────────────│       │──────────────│
│ _id          │       │ _id          │       │ _id          │
│ name         │       │ name         │       │ provider     │
│ email (U)    │       │ owner→User   │       │ model        │
│ password     │       │ members[]    │       │ apiKey       │
│ role         │       │ createdAt    │       │ isActive     │
│ avatar       │       └──────────────┘       └──────────────┘
│ isActive     │
│ jiraApiToken │       ┌──────────────┐       ┌──────────────┐
│ jiraEmail    │       │  AuditLog    │       │ AIUsageLog   │
│ jiraDomain   │       │──────────────│       │──────────────│
│ githubToken  │       │ _id          │       │ _id          │
│ githubUser   │       │ project→Proj │       │ provider     │
│ githubRepo   │       │ user→User    │       │ model        │
│ lastLogin    │       │ action       │       │ operation    │
│ emailOTP     │       │ entity       │       │ tokens       │
│ isEmailVerif │       │ entityId     │       │ latencyMs    │
│ createdAt    │       │ details      │       │ status       │
│ updatedAt    │       │ ipAddress    │       │ createdAt    │
└──────┬───────┘       │ createdAt    │       └──────────────┘
       │               └──────────────┘
       │ 1:N
       ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   Project    │       │  Document    │       │ Requirement  │
│──────────────│       │──────────────│       │──────────────│
│ _id          │──1:N──│ _id          │       │ _id          │
│ name         │       │ project→Proj │       │ project→Proj │
│ key (U+owner)│       │ name         │       │ functional[] │
│ owner→User   │       │ filePath     │       │ nonFunctional│
│ members[]    │       │ fileType     │       │ modules[]    │
│ status       │       │ status       │       │ actors[]     │
│ jiraProjKey  │       │ isActive     │       │ createdAt    │
│ githubRepo   │       │ chunks[]     │       └──────────────┘
│ completion%  │       │ requirement  │
│ color        │       │ Map          │       ┌──────────────┐
│ createdAt    │       │ requirement  │       │BacklogHistory│
└──────┬───────┘       │ Graph        │       │──────────────│
       │               │ createdAt    │       │ _id          │
       │ 1:N           └──────────────┘       │ project→Proj │
       │                                      │ user→User    │
       ├──────────────────────────────┐       │ title        │
       │                              │       │ moduleName   │
       ▼                              ▼       │ payload(JSON)│
┌──────────────┐       ┌──────────────┐       │ source       │
│    Epic      │       │   Story      │       │ createdAt    │
│──────────────│       │──────────────│       └──────────────┘
│ _id          │──1:N──│ _id          │
│ project→Proj │       │ project→Proj │       ┌──────────────┐
│ title        │       │ epic→Epic    │       │   Sprint     │
│ description  │       │ type (enum)  │       │──────────────│
│ status       │       │ title        │       │ _id          │
│ priority     │       │ description  │       │ project→Proj │
│ sprint       │       │ status(enum) │       │ name (S1-S4) │
│ epicKey      │       │ codeStatus   │       │ status       │
│ totalStories │       │ priority     │       │ startDate    │
│ completedStor│       │ storyPoints  │       │ endDate      │
│ aiGenerated  │       │ sprint(S1-S4)│       │ goal         │
│ createdAt    │       │ assignee→User│       │ stories[]    │
└──────────────┘       │ parentStory→ │       │ createdAt    │
                       │   Story(self)│       └──────────────┘
                       │ jiraIssueId  │
                       │ jiraIssueKey │       ┌──────────────┐
                       │ codeEvidence │       │   Commit     │
                       │ aiGenerated  │       │──────────────│
                       │ order        │       │ _id          │
                       │ labels[]     │       │ projectId    │
                       │ startDate    │       │ sha          │
                       │ dueDate      │       │ message      │
                       │ comments[]   │       │ author       │
                       │ createdAt    │       │ date         │
                       └──────────────┘       │ filesChanged │
                                              └──────────────┘
```

### 9.2 Key Relationships

| Relationship | Type | Implementation |
|-------------|------|----------------|
| User → Project | 1:N (owner) + M:N (members) | `owner` ref + `members[].user` ref |
| Project → Story | 1:N | `project` ref on Story |
| Project → Epic | 1:N | `project` ref on Epic |
| Project → Document | 1:N | `project` ref on Document |
| Project → Sprint | 1:N | `project` ref on Sprint |
| Epic → Story | 1:N | `epic` ref on Story |
| Story → Story | 1:N (self-referential) | `parentStory` ref on Story (for subtasks) |
| Story → User | N:1 (assignee, reporter) | `assignee`, `reporter` refs on Story |
| Project → Commit | 1:N | `projectId` string on Commit (not a ref!) |
| Project → AuditLog | 1:N | `project` ref on AuditLog |
| Project → BacklogHistory | 1:N | `project` ref on BacklogHistory |

**⚠️ Critical Issue:** `Commit.projectId` is stored as a plain string, not a MongoDB ObjectId ref. This breaks the pattern used by all other models and means Commit records CANNOT be populated via `.populate()`.

### 9.3 Enum Constraints

| Model | Field | Valid Values |
|-------|-------|-------------|
| Story | type | story, task, bug, subtask |
| Story | status | draft, approved, to_do, in_progress, in_review, done, cancelled |
| Story | codeStatus | not_started, partial, done |
| Story | priority | highest, high, medium, low, lowest |
| Story | sprint | S1, S2, S3, S4, backlog |
| Project | status | planning, active, paused, completed, archived |
| User | role | manager, scrum_master, admin |

---

## 10. API Catalog & Workflows

### 10.1 Complete API Reference

```
AUTH ENDPOINTS (all /api/auth)
┌────────┬─────────────────────────────┬──────────┬──────────────────────────────────┐
│ Method │ Path                        │ Access   │ Description                      │
├────────┼─────────────────────────────┼──────────┼──────────────────────────────────┤
│ POST   │ /register                   │ Public   │ Register with email OTP          │
│ POST   │ /verify-email               │ Public   │ Verify OTP, activate account     │
│ POST   │ /resend-otp                 │ Public   │ Resend verification OTP          │
│ POST   │ /login                      │ Public   │ Login with email+password        │
│ POST   │ /admin-login                │ Public   │ Admin login (env-based or DB)    │
│ GET    │ /me                         │ Private  │ Get current user profile         │
│ PUT    │ /profile                    │ Private  │ Update name, Jira/GitHub profile │
│ PUT    │ /integrations               │ Private  │ Save Jira/GitHub API tokens      │
│ POST   │ /logout                     │ Private  │ Logout (client-side only)        │
│ POST   │ /forgot-password            │ Public   │ Send password reset email        │
│ PUT    │ /reset-password/:token      │ Public   │ Reset password with token        │
│ GET    │ /github                     │ Public   │ Initiate GitHub OAuth            │
│ GET    │ /github/callback            │ Public   │ GitHub OAuth callback            │
│ GET    │ /google                     │ Public   │ Initiate Google OAuth            │
│ GET    │ /google/callback            │ Public   │ Google OAuth callback            │
└────────┴─────────────────────────────┴──────────┴──────────────────────────────────┘

PROJECT ENDPOINTS (all /api/projects)
┌────────┬─────────────────────────────┬──────────┬──────────────────────────────────┐
│ GET    │ /                           │ Private  │ List user's projects             │
│ GET    │ /:id                        │ Private  │ Get single project               │
│ POST   │ /                           │ Private  │ Create project (validates Jira+GitHub) │
│ PUT    │ /:id                        │ Private  │ Update project (owner only)      │
│ DELETE │ /:id                        │ Private  │ Delete project (owner only)      │
│ POST   │ /:id/invite                 │ Private  │ Invite member by email           │
│ DELETE │ /:id/members/:userId        │ Private  │ Remove member (owner only)       │
│ GET    │ /:id/audit                  │ Private  │ Get project audit log            │
│ GET    │ /:id/users                  │ Private  │ Get assignable project users     │
└────────┴─────────────────────────────┴──────────┴──────────────────────────────────┘

STORY ENDPOINTS (all /api/stories)
┌────────┬─────────────────────────────┬──────────┬──────────────────────────────────┐
│ GET    │ /project/:projectId         │ Private  │ List stories (filterable)        │
│ GET    │ /epics/:projectId           │ Private  │ List epics for project           │
│ GET    │ /project-state/:projectId   │ Private  │ Get project state snapshot       │
│ POST   │ /suggest/:projectId         │ Private  │ AI suggest planning paths        │
│ POST   │ /generate/:projectId        │ Private  │ AI generate backlog hierarchy    │
│ POST   │ /generate-preview/:projectId│ Private  │ Preview generation prompt        │
│ POST   │ /save/:projectId            │ Private  │ Save generated backlog           │
│ GET    │ /backlog-history/:projectId │ Private  │ Get backlog generation history   │
│ POST   │ /                           │ Private  │ Create story manually            │
│ PUT    │ /:id                        │ Private  │ Update story                     │
│ DELETE │ /:id                        │ Private  │ Delete story                     │
│ POST   │ /bulk-assign                │ Private  │ Bulk assign stories to user      │
└────────┴─────────────────────────────┴──────────┴──────────────────────────────────┘

DOCUMENT ENDPOINTS (all /api/documents)
┌────────┬─────────────────────────────┬──────────┬──────────────────────────────────┐
│ GET    │ /project/:id                │ Private  │ List project documents           │
│ POST   │ /upload/:id                 │ Private  │ Upload document (multipart)      │
│ POST   │ /:id/reingest               │ Private  │ Re-ingest document               │
│ GET    │ /:id/status                 │ Private  │ Get document processing status   │
└────────┴─────────────────────────────┴──────────┴──────────────────────────────────┘

JIRA ENDPOINTS (all /api/jira)
┌────────┬─────────────────────────────┬──────────┬──────────────────────────────────┐
│ GET    │ /test                       │ Private  │ Test Jira connection             │
│ POST   │ /push/:projectId            │ Private  │ Push backlog to Jira             │
│ GET    │ /sync/:projectId            │ Private  │ Sync Jira status back            │
└────────┴─────────────────────────────┴──────────┴──────────────────────────────────┘

GITHUB ENDPOINTS (all /api/github)
┌────────┬─────────────────────────────┬──────────┬──────────────────────────────────┐
│ POST   │ /connect/:projectId         │ Private  │ Connect GitHub repo              │
│ POST   │ /analyze/:projectId         │ Private  │ Analyze commits vs stories       │
└────────┴─────────────────────────────┴──────────┴──────────────────────────────────┘

SPRINT ENDPOINTS (all /api/sprints)
┌────────┬─────────────────────────────┬──────────┬──────────────────────────────────┐
│ GET    │ /project/:projectId         │ Private  │ List sprints                     │
│ POST   │ /project/:projectId         │ Private  │ Create sprint                    │
│ PUT    │ /:id                        │ Private  │ Update sprint                    │
│ DELETE │ /:id                        │ Private  │ Delete sprint                    │
│ POST   │ /:id/activate               │ Private  │ Activate sprint                  │
│ POST   │ /:id/complete               │ Private  │ Complete sprint                  │
└────────┴─────────────────────────────┴──────────┴──────────────────────────────────┘

OTHER ENDPOINTS
┌────────┬─────────────────────────────┬──────────┬──────────────────────────────────┐
│ GET    │ /api/dashboard              │ Private  │ Dashboard statistics             │
│ GET    │ /api/insights/project/:id   │ Private  │ AI-powered project insights      │
│ POST   │ /api/insights/standup/:id   │ Private  │ Generate standup summary         │
│ GET    │ /api/admin/*                │ Admin    │ Admin panel endpoints            │
│ POST   │ /api/manual-bridge/*        │ Private  │ Manual data bridge operations    │
└────────┴─────────────────────────────┴──────────┴──────────────────────────────────┘
```

---

## 11. Authentication & Authorization

### 11.1 Token Flow

```
┌─────────┐     ┌──────────┐     ┌──────────┐
│  Client │     │ Backend  │     │ MongoDB  │
└────┬────┘     └────┬─────┘     └────┬─────┘
     │               │               │
     │ POST /login   │               │
     │ {email,pass}  │               │
     │──────────────▶│               │
     │               │ findOne(email)│
     │               │──────────────▶│
     │               │◀──────────────│
     │               │ bcrypt.compare│
     │               │ jwt.sign()    │
     │ {token, user} │               │
     │◀──────────────│               │
     │               │               │
     │ GET /projects │               │
     │ Authorization:│               │
     │ Bearer <JWT>  │               │
     │──────────────▶│               │
     │               │ jwt.verify()  │
     │               │ findById(id)  │
     │               │──────────────▶│
     │               │◀──────────────│
     │               │ check isActive│
     │ { data: [...]}│               │
     │◀──────────────│               │
```

### 11.2 Authorization Matrix

| Action | admin | scrum_master | manager |
|--------|-------|-------------|--------|
| View all projects | ✓ | Own/member only | Own/member only |
| Create project | ✗ (blocked) | ✓ | ✓ |
| Delete project | ✓ (own only via admin) | Own only | Own only |
| Invite members | ✗ | Own project only | ✗ |
| Generate AI stories | ✗ | ✓ | ✗ |
| Save generated stories | ✗ | ✓ | ✗ |
| Push to Jira | ✗ | ✓ | ✗ |
| View admin panel | ✓ | ✗ | ✗ |
| Manage AI config | ✓ | ✗ | ✗ |
| Update own profile | ✓ | ✓ | ✓ |
| Update integrations | ✓ | ✓ | ✓ |

### 11.3 Email OTP Verification

The registration flow uses a 6-digit OTP sent via SMTP:
- OTP expiry: 10 minutes
- Resend allowed: yes
- Auto-verify on login: If user logs in with correct password before verifying email, they are auto-verified (trust-based: password ownership = email ownership)
- Dev mode fallback: If SMTP fails in development, the OTP is returned in the API response as `devOTP`

### 11.4 OAuth (GitHub & Google)

Both providers follow OAuth 2.0 Authorization Code Grant:
1. Frontend redirects user to `/api/auth/github` or `/api/auth/google`
2. Backend redirects to provider's authorization page
3. Provider redirects to backend callback URL
4. Backend exchanges code for access token
5. Backend fetches user profile (email, name, avatar)
6. Backend creates/finds User, generates JWT
7. Backend redirects to frontend `/auth/callback?token=...&user=...`
8. Frontend AuthCallback page extracts token + user from URL, sets in authStore

**⚠️ Security Note:** User data is passed as a URL query parameter in the OAuth callback redirect. This exposes user data (including email) in browser history and potentially to third-party scripts. For production, this should use a server-side session or a one-time code exchange.

---

## 12. External Integrations

### 12.1 Jira Integration (REST API v3)

```
Authentication: Basic Auth (email + API token)
Base URL: https://{domain}/rest/api/3

Operations:
├── Test connection: GET /project/{key}
├── Create epic: POST /issue (with issuetype: Epic)
├── Create story/task: POST /issue (with parent field)
├── Get issue: GET /issue/{key}
└── Search issues: GET /search?jql=project={key}

Push Order (critical):
1. Create epics first → get Jira epic keys
2. Create stories → set parent to matching epic key
3. Create tasks → set parent to matching story key
4. Create subtasks → set parent to matching task key
→ Map local _id to Jira issue key for future sync
```

### 12.2 GitHub Integration (REST API v3)

```
Authentication: Personal Access Token (classic, repo scope)
Base URL: https://api.github.com

Operations:
├── Validate repo: GET /repos/{owner}/{repo}
├── Validate branch: GET /repos/{owner}/{repo}/branches/{branch}
├── List commits: GET /repos/{owner}/{repo}/commits?sha={branch}
├── Get commit: GET /repos/{owner}/{repo}/commits/{sha} (with diff)
└── Code analysis: Backend sends commit diff + story AC to AI service
```

### 12.3 AI Providers (via OpenRouter API)

```
Default: OpenRouter (openrouter.ai)
  - Free model: google/gemini-2.0-flash-exp:free
  - Requires: OPENROUTER_API_KEY
  - Base URL: https://openrouter.ai/api/v1

Alternative 1: DeepSeek Official API
  - Model: deepseek-chat
  - Requires: DEEPSEEK_API_KEY
  - Base URL: https://api.deepseek.com/v1

Alternative 2: Self-hosted DeepSeek (Ollama/vLLM)
  - Requires: DEEPSEEK_LOCAL_API_KEY, DEEPSEEK_LOCAL_BASE_URL
  - Base URL: configurable
```

### 12.4 Email Service (SMTP via Resend)

```
Primary: Resend (resend.com)
  - SMTP_HOST=smtp.resend.com
  - SMTP_USER=resend
  - SMTP_PASS=re_... (API key)
  - From address: notifications@devtrack.ai

Fallback: Any SMTP server via env vars
  - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
  - Configurable FROM_EMAIL, FROM_NAME
```

### 12.5 Email Deliverability Validation (AbstractAPI)

```
Purpose: Prevent fake/disposable email registrations
API: https://emailreputation.abstractapi.com/v1/
Requires: ABSTRACT_API_KEY
Behavior: Fail-closed for undeliverable/disposable; fail-open for API errors
```

---

## 13. State Management

### 13.1 Client-Side (Zustand)

All Zustand stores use the `persist` middleware, which serializes state to `localStorage`. This means:
- **Auth token survives page refresh** (user stays logged in)
- **Workspace drafts survive navigation** (planner context preserved)
- **Notification history persists across sessions**

**⚠️ Security Concern:** JWT tokens stored in localStorage are vulnerable to XSS attacks. Recommended migration to httpOnly cookies for production.

### 13.2 Server-Side State

The backend is stateless (no sessions). All state lives in:
- **MongoDB:** All persistent data
- **JWT:** User identity (stateless verification)
- **Socket.io rooms:** Real-time project membership

### 13.3 WebSocket Events (Socket.io)

```
Client → Server:
├── join-project {projectId}     → Join project room
├── leave-project {projectId}    → Leave project room
└── manual-bridge:sync           → Request manual bridge snapshot

Server → Client (project room):
├── stories:saved {counts}       → After bulk save
├── story:created {story}        → After single story creation
├── story:updated {story}        → After story update
├── story:deleted {storyId}      → After story deletion
├── story:assigned {story}       → After assignment change
├── document:status {status}     → Document ingestion progress
├── sprint:closed {sprint}       → Auto-closed sprint notification
└── notification {message, type} → General notification
```

---

## 14. Design Patterns

### 14.1 Patterns Identified in the Codebase

| Pattern | Where Used | Notes |
|---------|-----------|-------|
| **Controller-Service-Router** | Backend | Standard Express pattern with thin routers, fat controllers, and shared services |
| **Repository Pattern (via Mongoose)** | Backend models | Mongoose provides data access abstraction |
| **Bridge Pattern** | aiService.js | Abstracts AI service HTTP calls behind a clean JS API |
| **Factory Pattern** | llm_service.py | Different LLM clients created based on provider config |
| **Strategy Pattern** | llm_service.py | Different AI providers (OpenRouter, DeepSeek API, DeepSeek Local) are interchangeable strategies |
| **Chain of Responsibility** | Middleware stack | Helmet → CORS → Rate Limit → Auth → Controller cascade |
| **Observer Pattern** | Socket.io events | Publish-subscribe for real-time updates |
| **Singleton** | socket.js, api.js | Single Socket.io client and Axios instance |
| **Module Pattern** | Zustand stores | Each store is a self-contained module with state + actions |
| **Lazy Initialization** | EmbeddingService | ONNX model loaded only on first use |
| **Retry Pattern** | aiService.js | `postWithRetry` with exponential backoff (250ms × attempt) |
| **Circuit Breaker (partial)** | aiService.js | `isServiceUnavailableError` + `asServiceUnavailable` |
| **Fail-Open Pattern** | AbstractAPI email check | API errors don't block registration |
| **Normalizer Pattern** | storyController.js | `normalizeRole`, `normalizeJiraDomain`, `normalizeBacklogDraft` |

### 14.2 Anti-Patterns

| Anti-Pattern | Location | Impact |
|-------------|----------|--------|
| **God Controller** | storyController.js (1290 lines) | Hard to test, high cognitive load |
| **Dead Code** | getMockStories, getMockSuggestions in aiService.js | Functions exist but are never called; misleading |
| **String-based refs** | Commit.projectId | Breaks Mongoose `.populate()` consistency |
| **Environment-dependent logic** | authController.js | `if (process.env.NODE_ENV === 'development')` scattered in multiple places |
| **Direct console I/O** | rag_service.py line 140 | Uses `print()` instead of `logger` |
| **Inconsistent error shapes** | Various controllers | Some return `{success, message}`, others include `errors[]`, `data{}` |
| **Missing input validation** | Multiple controllers | Only some use model validators; others trust client input |

---

## 15. Important Algorithms

### 15.1 Vectorless Context Graph Builder (storyController.js)

```
ALGORITHM: buildVectorlessContextGraph(projectId)
Purpose: Build a comprehensive project context without expensive vector queries

1. Parallel fetch: Project, Documents (3), Epics (20), Stories (200), Sprints (20), Commits (40)
2. Transform each collection into nodes with type, id, and relevant fields
3. Build edges: story→epic (contains), story→parentStory (parent_of)
4. Calculate stats: total/done/in-progress/backlog stories, active sprints, recent commits
5. Return: { project, nodes: {documents, epics, stories, sprints, commits}, edges, stats }

Time Complexity: O(D+E+S+P+C) where D=documents, E=epics, S=stories, P=sprints, C=commits
Space Complexity: O(S) dominated by story nodes + edges
```

### 15.2 Multi-Stage RAG Retrieval (ai-service/routers/stories.py)

```
ALGORITHM: Context Retrieval Cascade for Story Generation
Input: project_id, module_name, chunk_refs, requirement_ids

1. IF chunk_refs exist:
   → STAGE 1 (Exact): rag_service.get_chunks_by_refs(chunk_refs)
   → Direct ID lookup, O(n) where n = len(chunk_refs)

2. ELIF requirement_ids exist:
   → STAGE 2 (Targeted): rag_service.get_chunks_by_ids(requirement_ids, top_k)
   → Metadata-filtered query per requirement, O(r * c) where r=reqs, c=collections

3. ELSE:
   → STAGE 3 (Similarity): rag_service.retrieve(module_name, project_id, top_k)
   → Vector similarity search across all project collections
   → Uses ONNX embeddings, O(k log n) with ChromaDB HNSW index

4. Deduplicate results (seen set)
5. Concatenate chunks as context for LLM
```

### 15.3 Backlog Normalization & Validation (storyController.js)

```
ALGORITHM: validateGeneratedPayload({ epics, stories, tasks, subtasks })

1. Validate each item has a non-empty title
2. Build ID sets: epicIds, storyIds, taskIds
3. Validate stories reference valid epicTempId
4. Validate tasks reference valid epicTempId + parentTempId (story)
5. Validate subtasks reference valid epicTempId + parentTempId (task)
6. Return errors array (empty if valid)

ALGORITHM: buildProjectAssigneeResolver(project)

1. Fetch all project members (owner + members)
2. Build two maps: byId (ObjectId → ObjectId) and byLookup (name/email → ObjectId)
3. Return resolver function: (value) → ObjectId or undefined
4. Resolver matches by: ObjectId string → ID map → name → email → jiraEmail
```

### 15.4 SRV DNS Fallback (db.js)

```
ALGORITHM: MongoDB Connection with SRV Fallback

1. Try connection with MONGO_URI (mongodb+srv://)
2. If SRV lookup fails (ENOTFOUND on _mongodb._tcp SRV record):
   → Check if MONGO_URI_DIRECT or MONGO_URI_FALLBACK is configured
   → Try direct mongodb:// connection (bypasses SRV DNS)
   → Log warning, continue with direct connection
3. If both fail, exit process with error
```

### 15.5 Sprint Auto-Closure (sprintService.js + jobs.js)

```
ALGORITHM: Hourly Sprint Auto-Closure Check

1. Find all sprints where: status='active' AND endDate < now
2. For each expired sprint:
   a. Set sprint.status = 'completed'
   b. For each story in sprint not 'done':
      - If next sprint exists: move to next sprint
      - Else: move to 'backlog'
   c. Emit 'sprint:closed' Socket.io event
   d. Log closure
```

---

## 16. Configuration & Environment Variables

### 16.1 Backend (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | YES | — | MongoDB Atlas connection string (mongodb+srv://) |
| `MONGO_URI_DIRECT` | NO | — | Fallback direct MongoDB URI |
| `MONGO_URI_FALLBACK` | NO | — | Alternative name for direct URI |
| `JWT_SECRET` | YES | — | JWT signing secret (min 32 chars recommended) |
| `JWT_EXPIRE` | NO | 7d | JWT token expiry |
| `PORT` | NO | 5000 | Backend server port |
| `FRONTEND_URL` | NO | http://localhost:5173 | Frontend URL for CORS + OAuth redirects |
| `BACKEND_URL` | NO | http://localhost:5000 | Backend URL for OAuth callbacks |
| `AI_SERVICE_URL` | NO | http://localhost:8000 | AI service base URL |
| `AI_INGEST_TIMEOUT_MS` | NO | 0 | Timeout for document ingestion (0 = no timeout) |
| `NODE_ENV` | NO | development | Environment mode |
| `RATE_LIMIT_WINDOW_MS` | NO | 900000 (15min) | Rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | NO | 500 | Max requests per window |
| `AUTH_RATE_LIMIT_MAX` | NO | 10 | Max auth requests per window |
| `SMTP_HOST` | NO | smtp.resend.com | SMTP server |
| `SMTP_PORT` | NO | 587 | SMTP port |
| `SMTP_USER` | NO | resend | SMTP username |
| `SMTP_PASS` | NO | — | SMTP password/API key |
| `FROM_EMAIL` | NO | notifications@devtrack.ai | Sender email |
| `FROM_NAME` | NO | DevTrack | Sender name |
| `ABSTRACT_API_KEY` | NO | — | AbstractAPI email validation key |
| `GITHUB_CLIENT_ID` | NO | — | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | NO | — | GitHub OAuth app client secret |
| `GOOGLE_CLIENT_ID` | NO | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | NO | — | Google OAuth client secret |
| `ADMIN_EMAIL` | NO | — | Platform admin email |
| `ADMIN_PASSWORD` | NO | — | Platform admin password |

### 16.2 AI Service (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | YES* | — | OpenRouter API key |
| `OPENAI_API_KEY` | NO | — | Fallback if OPENROUTER_API_KEY not set |
| `DEEPSEEK_API_KEY` | NO | — | DeepSeek official API key |
| `DEEPSEEK_LOCAL_API_KEY` | NO | — | Self-hosted DeepSeek API key |
| `DEEPSEEK_LOCAL_BASE_URL` | NO | — | Self-hosted DeepSeek base URL |
| `LLM_MODEL` | NO | google/gemini-2.0-flash-exp:free | Default LLM model |
| `MAX_TOKENS` | NO | 8192 | Max tokens per LLM call |
| `PORT` | NO | 8000 | AI service port |
| `CHROMA_PERSIST_DIR` | NO | ./chroma_store | Vector DB storage directory |
| `EMBEDDING_MODEL` | NO | local-onnx | Embedding model identifier |
| `TOP_K_RETRIEVAL` | NO | 5 | Default similarity search results |
| `TOP_K_RETRIEVAL_PER_ID` | NO | 2 | Chunks per requirement ID |
| `MONGO_URI` | NO | — | Optional MongoDB access (for document reads) |

### 16.3 Frontend (.env or Vite env)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | http://localhost:5000/api | Backend API base URL |
| `VITE_WS_URL` | http://localhost:5000 | WebSocket server URL |
| `VITE_AI_SERVICE_URL` | http://localhost:8000 | AI service URL (for health checks) |

---

## 17. Dependencies

### 17.1 Backend (package.json)

```
CORE:
  express: ^4.18.2         — Web framework
  mongoose: ^8.1.1         — MongoDB ODM
  jsonwebtoken: ^9.0.2     — JWT creation/verification
  bcryptjs: ^2.4.3         — Password hashing
  socket.io: ^4.7.4        — WebSocket server

SECURITY:
  helmet: ^7.1.0           — Security headers
  cors: ^2.8.5             — Cross-Origin Resource Sharing
  express-rate-limit: ^7.1.5 — Rate limiting
  express-mongo-sanitize: ^2.2.0 — NoSQL injection prevention
  hpp: ^0.2.3              — HTTP parameter pollution prevention

FILE/HTTP:
  multer: ^1.4.5-lts.1     — File upload handling
  axios: ^1.6.5            — HTTP client (for AI service + external APIs)
  compression: ^1.7.4      — Response compression

LOGGING:
  winston: ^3.11.0         — Structured logger
  morgan: ^1.10.0          — HTTP request logger (streams to winston)

EMAIL:
  nodemailer: ^6.9.8       — SMTP email sending

UTILITY:
  dotenv: ^16.3.1          — .env file loading
  express-async-errors: ^3.1.1 — Async error handling
  uuid: ^9.0.0             — UUID generation (crypto.randomUUID used instead)
  node-cron: ^3.0.3        — Scheduled job runner
```

### 17.2 Frontend (package.json)

```
CORE:
  react: ^18.2.0           — UI framework
  react-dom: ^18.2.0       — DOM renderer
  react-router-dom: ^6.21.1 — Client-side routing

STATE & DATA:
  zustand: ^4.4.7          — State management
  @tanstack/react-query: ^5.17.9 — Server state
  axios: ^1.6.5            — HTTP client

UI:
  tailwindcss: ^3.4.1      — Utility-first CSS
  @headlessui/react: ^1.7.17 — Accessible UI primitives
  @heroicons/react: ^2.1.1 — SVG icon library
  framer-motion: ^10.18.0  — Animation library
  recharts: ^2.10.3        — Charting library
  react-hot-toast: ^2.4.1  — Toast notifications

BUILD:
  vite: ^5.0.11            — Build tool
  @vitejs/plugin-react: ^4.2.1 — React Fast Refresh

REAL-TIME:
  socket.io-client: ^4.7.4 — WebSocket client
```

### 17.3 AI Service (requirements.txt)

```
CORE:
  fastapi: ^0.109.0        — Web framework
  uvicorn: ^0.25.0         — ASGI server
  pydantic: ^2.5.3         — Data validation

AI/ML:
  openai: ^1.12.0          — OpenAI-compatible client (used for OpenRouter/DeepSeek)
  chromadb: ^0.4.22        — Vector database
  onnxruntime: ^1.16.3     — ONNX model runtime (for embeddings)
  langchain: ^0.1.0        — LLM framework (limited usage)
  langchain-community: ^0.0.10 — Community integrations

DOCUMENT PROCESSING:
  PyPDF2: ^3.0.1           — PDF text extraction
  python-docx: ^1.1.0      — DOCX text extraction
  python-magic: ^0.4.27    — MIME type detection
  unstructured: ^0.12.0    — Advanced document parsing

UTILITY:
  python-dotenv: ^1.0.0    — .env loading
  httpx: ^0.26.0           — Async HTTP client
```

---

## 18. Error Handling & Logging

### 18.1 Backend Error Handling

```
HIERARCHY:
1. express-async-errors → Wraps async route handlers
2. Route handler try/catch → Controller-level error catching
3. Custom error classes → aiService.js creates typed errors (AI_SERVICE_UNAVAILABLE, AI_GENERATION_FAILED)
4. errorHandler middleware → Last resort: formats error response
5. notFound middleware → Catches unmatched routes (404)

ERROR RESPONSE FORMAT:
{
  success: false,
  message: "Human-readable error message",
  errorCode: "AI_INTERNAL_ERROR",  // Optional, standardized codes
  requestId: "uuid",               // For tracing in logs
  errors: [],                      // Optional, validation errors
  data: {}                         // Optional, additional context
}

PROCESS HANDLERS:
- unhandledRejection → logged, process continues
- uncaughtException → logged, exit on EADDRINUSE, continue otherwise
- SIGTERM → graceful shutdown (stop jobs, close HTTP server)
```

### 18.2 AI Service Error Handling

```
LAYERS:
1. Pydantic validation → RequestValidationError handler (422)
2. Router try/except → HTTPException (502 for upstream failures)
3. Global exception handler → Catches all unhandled exceptions
   - Maps known errors to user-friendly messages
   - Masks API keys in error messages
   - Returns standardized JSON response

SPECIAL CASES:
- API key missing: "AI provider API key is not configured"
- Rate limit: "AI provider rate limit reached"
- Invalid JSON: "AI provider returned an invalid structured response"
- Unknown: "AI service failed to process the request"
```

### 18.3 Logging Strategy

```
BACKEND:
- Winston logger with console transport only (no file transport!)
- Format: JSON in production, colorized console in development
- Level: debug (dev), warn (prod)
- Morgan HTTP logging streams to Winston
- Request ID attached to every log line

AI SERVICE:
- Standard Python logging module
- ChromaDB telemetry logging suppressed
- Verbose RAG retrieval logging for debugging
- LLM call metadata tracked via ContextVar

⚠️ ISSUES:
- No file-based logging (logs lost on restart)
- No log aggregation (ELK, Loki, etc.)
- No structured logging in AI service (printf-style)
- No log rotation configured
```

---

## 19. Security Analysis

### 19.1 Strengths

| Feature | Implementation |
|---------|---------------|
| Password hashing | bcrypt with 12 salt rounds |
| JWT authentication | Stateless tokens with configurable expiry |
| CORS | Whitelist-based origin checking |
| Rate limiting | Global + auth-specific rate limits |
| NoSQL injection prevention | express-mongo-sanitize |
| HTTP parameter pollution | hpp middleware |
| Security headers | helmet (HSTS, CSP, XSS protection, etc.) |
| API key masking | Tokens never returned in API responses (select: false on sensitive fields) |
| OTP verification | Email verification with 10-min expiry |
| Password reset | Hashed token with 15-min expiry |

### 19.2 Weaknesses & Vulnerabilities

| Issue | Severity | Details |
|-------|----------|---------|
| **JWT in localStorage** | HIGH | Vulnerable to XSS; should use httpOnly cookies |
| **OAuth user data in URL** | MEDIUM | User profile passed as query param in redirect |
| **No CSRF protection** | MEDIUM | No CSRF tokens on state-changing requests |
| **Missing input sanitization** | MEDIUM | Some endpoints trust client input without validation |
| **50MB body limit** | LOW | Large payload DoS risk (mitigated by rate limiting) |
| **No encryption at rest** | LOW | ChromaDB local files unencrypted; MongoDB Atlas has default encryption |
| **API keys in .env** | LOW | Standard practice but keys are plaintext on disk |
| **No audit for sensitive ops** | LOW | Some mutations don't create AuditLog entries |
| **Debug info leakage** | LOW | devOTP and devResetUrl returned in development mode |
| **Missing Content-Security-Policy** | MEDIUM | Helmet CSP not explicitly configured |

---

## 20. Performance Bottlenecks

### 20.1 Known Bottlenecks

| Bottleneck | Location | Impact | Mitigation |
|-----------|----------|--------|------------|
| **N+1 Queries in story save** | storyController.saveGeneratedStories | Each story creates sequentially in a for-loop; 100 stories = 100 DB writes | Batch create with `insertMany` |
| **Synchronous epic count updates** | updateProjectCounts | Updates every epic's counts serially in a for-loop after every story change | Batch update, or compute counts on read |
| **Full context graph on every suggest** | buildVectorlessContextGraph | Fetches up to 200 stories, 40 commits, 20 sprints per request | Cache context graph for short TTL |
| **Large JSON context to LLM** | storyController.generateStories | Sends entire project state + requirement graph as context string | Token counting + truncation strategy needed |
| **ChromaDB list_collections** | rag_service.py | Scans all collections on every retrieval | Cache collection list per project |
| **No database query limiting** | storyController.getStoriesByProject | No default limit; could return 1000s of stories | Add pagination with default limit |
| **Sequential AI calls in suggest** | storyController.suggestStories | discoverGaps → getChunksByIds → suggestStories (3 serial LLM calls) | Parallelize independent calls |
| **ONNX model loading** | EmbeddingService | Model loaded synchronously on first use, blocking the event loop | Preload at startup or use async loading |

### 20.2 Database Index Analysis

```
CURRENT INDEXES:
- User: email (unique) ✓
- Project: { key: 1, owner: 1 } (unique compound) ✓
- Story: { project: 1, status: 1 } ✓
- Story: { epic: 1 } ✓
- Story: { assignee: 1 } ✓

MISSING INDEXES (recommended):
- Story: { project: 1, type: 1 } — for type-filtered listing
- Story: { project: 1, sprint: 1 } — for sprint-based queries
- Story: { parentStory: 1 } — for subtask lookups
- Document: { project: 1, isActive: 1, status: 1 } — for active doc queries
- Commit: { projectId: 1, date: -1 } — for recent commit queries
- Epic: { project: 1, status: 1 } — for epic filtering
- Sprint: { project: 1, status: 1 } — for active sprint lookup
- AuditLog: { project: 1, createdAt: -1 } — for audit log queries
- BacklogHistory: { project: 1, createdAt: -1 } — for history queries
```

---

## 21. Code Quality & Technical Debt

### 21.1 Critical Issues

| Issue | File | Lines | Fix |
|-------|------|-------|-----|
| God controller | storyController.js | 1290 | Split into: suggestController, generateController, crudController, saveController |
| God service | llm_service.py | 1675 | Split by provider: openrouter.py, deepseek.py, deepseek_local.py |
| Dead code | aiService.js | 491-641 | Remove `getMockSuggestions` and `getMockStories` (never called) |
| Dead code path | stories.py | 97-243 | Three-step pipeline (extract→format→critic) not wired to main generate endpoint |
| Console.log in service | rag_service.py | 140 | Replace `print()` with `logger.error()` |
| Inconsistent ref types | Commit.js | — | `projectId` is String, not ObjectId — breaks populate pattern |
| Magic strings | Various | — | Sprint values ('S1'-'S4'), status enums repeated as literals |
| Missing TypeScript | Entire codebase | — | No type safety anywhere (JS + Python without mypy) |
| No API versioning | All routes | — | Routes use `/api/` without version prefix (`/api/v1/`) |

### 21.2 Medium Issues

| Issue | Details |
|-------|---------|
| No test coverage | Zero automated tests (unit, integration, or E2E) |
| No input validation library | Relies on Mongoose validation only; no Joi/Zod |
| Inconsistent error formats | Some return `{success, message}`, others `{success, message, errors[]}` |
| No API documentation | No Swagger/OpenAPI on backend; FastAPI has auto-docs but not customized |
| Mixed responsibility in controllers | Controllers handle validation, business logic, DB access, email, and socket emission |
| No dependency injection | Services instantiated directly, hard to mock for testing |
| Circular dependency risk | storyController → aiService → aiConfigService → aiUsageService (no formal DI container) |

### 21.3 Code Smells

- **Feature envy:** `storyController.js` accesses too many models directly (Story, Epic, Project, Document, Requirement, Commit, Sprint, User, BacklogHistory, AuditLog)
- **Long parameter lists:** `buildGenerateStoriesContext` has 8 parameters; `generateStories` in aiService.js has 12
- **Divergent change:** Adding a new AI feature requires changes in: frontend page, backend controller, backend aiService.js, ai-service router, ai-service llm_service.py
- **Shotgun surgery:** Changing a Story model field requires updates across 5+ controllers
- **Comment rot:** Some "FIX #1", "FIX #4" comments suggest past bugs were patched but code wasn't cleaned up

---

## 22. Scalability Concerns

### 22.1 Horizontal Scaling Readiness

| Component | Can Scale? | Blockers |
|-----------|-----------|----------|
| Frontend | Yes (static CDN) | None |
| Backend | Partially | Socket.io sticky sessions needed; no Redis adapter for multi-instance socket.io |
| AI Service | Yes (stateless) | ChromaDB is local — would need migration to ChromaDB server or Pinecone/Weaviate for multi-instance |
| MongoDB Atlas | Yes (managed) | None (Atlas handles sharding) |
| ChromaDB | No | Single-node local storage; no distributed mode supported |

### 22.2 Data Growth Concerns

| Concern | Impact | Solution |
|---------|--------|----------|
| Story collection growth | 1000s of stories per project → slow queries | Add pagination, compound indexes, consider archiving |
| ChromaDB growth | Embedding chunks grow linearly with documents | Add chunk TTL, periodic cleanup of unused collections |
| AuditLog unbounded growth | Millions of audit entries | Add TTL index for automatic cleanup |
| AIUsageLog unbounded growth | Cost tracking data accumulates | Archive or add retention policy |
| BacklogHistory payloads | Full JSON blobs in MongoDB documents | Consider storing large payloads in GridFS after N days |

### 22.3 Concurrency Issues

- **Sprint auto-closure race:** If two instances run the job simultaneously, stories could be double-moved. Use MongoDB `findOneAndUpdate` with atomic conditions.
- **Story save race:** Two users saving generated stories simultaneously could create duplicate storyKeys. Add unique index on `storyKey`.
- **Jira push idempotency:** No mechanism to prevent double-push. Should check `pushedToJira` flag atomically.

---

## 23. Deployment Process

### 23.1 Current Deployment (Development)

```
1. Clone repository
2. Install dependencies for each service
3. Configure .env files from .env.example
4. Start services:
   - Terminal 1: cd backend && npm run dev    (port 5000)
   - Terminal 2: cd ai-service && python main.py (port 8000)
   - Terminal 3: cd frontend && npm run dev   (port 5173)
5. All-in-one: npm run dev:all from root (uses concurrently)
```

### 23.2 Production Deployment Considerations

```
FRONTEND:
- Build: npm run build → static files in dist/
- Serve: Nginx or CDN (Cloudflare, Vercel)
- Env vars: Injected at build time (VITE_* vars)

BACKEND:
- Process manager: PM2 or Docker container
- Database: MongoDB Atlas (already configured)
- Redis: Required for multi-instance Socket.io
- SSL: Nginx reverse proxy with Let's Encrypt

AI SERVICE:
- Containerize: Docker with ChromaDB volume mount
- GPU: Optional for faster embeddings
- Scaling: Single instance fine for moderate loads; ChromaDB migration needed for multi-instance

RECOMMENDED DOCKER-COMPOSE STRUCTURE:
services:
  frontend:
    build: ./frontend
    ports: ["80:80"]
  backend:
    build: ./backend
    environment: [MONGO_URI, JWT_SECRET, ...]
    depends_on: [redis]
  ai-service:
    build: ./ai-service
    volumes: [chroma_data:/app/chroma_store]
    environment: [OPENROUTER_API_KEY, ...]
  redis:
    image: redis:7-alpine
volumes:
  chroma_data:
```

---

## 24. Testing Strategy

### 24.1 Current State

**There are zero automated tests.** The test files that exist (`test-jira-direct.js`, `test-email-send.js`, etc.) are ad-hoc manual test scripts, not part of a test suite.

### 24.2 Recommended Testing Pyramid

```
                    ┌──────────┐
                    │   E2E    │   Playwright/Cypress: Full user workflows
                    │  (5%)    │   (SRS upload → generate → save → Jira push)
                    ├──────────┤
                    │Integration│   Supertest + MongoDB Memory Server
                    │  (15%)   │   API endpoint testing with real DB
                    ├──────────┤
                    │   Unit   │   Jest (backend) + Vitest (frontend)
                    │  (80%)   │   + pytest (AI service)
                    └──────────┘
```

### 24.3 Critical Test Scenarios

```
HIGH PRIORITY:
1. Auth: Register → verify OTP → login → token refresh
2. Project: Create with Jira/GitHub validation → fail gracefully on invalid keys
3. Story generation: Mock AI service response → verify normalization logic
4. Story save: Validate hierarchy → verify parent-child mapping
5. Jira push: Mock Jira API → verify parent-first ordering
6. Sprint auto-closure: Verify story migration logic

MEDIUM PRIORITY:
7. Rate limiting: Verify 429 responses after threshold
8. OAuth: Mock provider callbacks → verify user creation/login
9. Socket.io: Verify project-room event broadcasting
10. Document ingestion: Verify status transitions (uploaded → processing → processed)

LOW PRIORITY:
11. Admin panel access control
12. Email notification sending
13. AI usage logging
14. Audit trail creation
```

---

## 25. Module Dependency Graph

```
frontend/src/pages/AIPlanner.jsx
  ├── lib/api.js ─────────────────────────────────────────────┐
  ├── store/projectStore.js                                    │
  ├── store/workspaceStateStore.js                             │
  └── store/notificationStore.js                               │
                                                               │
frontend/src/pages/BacklogEditor.jsx                           │
  ├── lib/api.js ─────────────────────────────────────────────┤
  └── store/projectStore.js                                    │
                                                               │
frontend/src/lib/api.js                                        │
  └── store/authStore.js (reads token)                         │
                                                               ▼
════════════════════════════════ HTTP ═══════════════════════════
                                                               │
backend/server.js                                              │
  ├── src/config/db.js                                         │
  ├── src/config/logger.js                                     │
  ├── src/config/jobs.js ─── src/services/sprintService.js     │
  ├── src/routes/auth.js ─── src/controllers/authController.js │
  │   ├── src/models/User.js                                   │
  │   ├── src/models/AuditLog.js                               │
  │   ├── src/services/email.js                                │
  │   └── src/services/workspaceBootstrapService.js            │
  ├── src/routes/stories.js ─── src/controllers/storyController│
  │   ├── src/models/Story.js, Epic.js, Project.js, etc.       │
  │   ├── src/services/aiService.js ─────────────────────┐     │
  │   │   ├── src/services/aiConfigService.js             │     │
  │   │   ├── src/services/aiUsageService.js              │     │
  │   │   └── src/utils/aiServiceUrl.js                   │     │
  │   └── src/services/socketService.js                   │     │
  └── ...                                                     │
                                                               │
══════════════════════════ HTTP ════════════════════════════════
                                                               │
ai-service/main.py                                             │
  ├── routers/stories.py ──────────────────────────────────────┘
  │   ├── services/llm_service.py
  │   │   └── services/manual_bridge_service.py
  │   └── services/rag_service.py
  │       └── services/embeddings.py
  ├── routers/documents.py
  │   ├── services/rag_service.py
  │   ├── services/embeddings.py
  │   ├── services/document_parser.py
  │   └── services/enhanced_document_parser.py
  ├── routers/github_analysis.py
  │   └── services/llm_service.py
  └── routers/jira.py
      └── services/llm_service.py
```

---

## 26. Sequence Diagrams

### 26.1 Complete SRS-to-Jira Workflow

```
User      Frontend       Backend          AI Service       MongoDB      ChromaDB     Jira
 │           │              │                 │               │            │           │
 │ Upload SRS│              │                 │               │            │           │
 │──────────▶│              │                 │               │            │           │
 │           │ POST /upload │                 │               │            │           │
 │           │─────────────▶│                 │               │            │           │
 │           │              │ Save file       │               │            │           │
 │           │              │────────────────────────────────▶│            │           │
 │           │              │ Create Document doc             │            │           │
 │           │              │                 │               │            │           │
 │           │              │ POST /documents/ingest          │            │           │
 │           │              │────────────────▶│               │            │           │
 │           │              │                 │ Parse file    │            │           │
 │           │              │                 │ Chunk text    │            │           │
 │           │              │                 │ Embed chunks  │            │           │
 │           │              │                 │───────────────────────────▶│           │
 │           │              │                 │ Store in ChromaDB          │           │
 │           │              │◀────────────────│               │            │           │
 │           │              │ Update status   │               │            │           │
 │           │              │───────────────▶│               │            │           │
 │           │              │                 │               │            │           │
 │           │              │ POST /stories/extract-requirements            │           │
 │           │              │────────────────▶│               │            │           │
 │           │              │                 │ LLM extract   │            │           │
 │           │              │◀────────────────│               │            │           │
 │           │              │ Save Requirement│               │            │           │
 │           │              │────────────────────────────────▶│            │           │
 │           │◀─────────────│ Doc ready       │               │            │           │
 │◀──────────│              │                 │               │            │           │
 │           │              │                 │               │            │           │
 │ Open Planner              │                 │               │            │           │
 │──────────▶│              │                 │               │            │           │
 │           │ GET /project-state             │               │            │           │
 │           │─────────────▶│────────────────────────────────▶│            │           │
 │           │◀─────────────│◀────────────────────────────────│            │           │
 │           │              │                 │               │            │           │
 │ Click Suggest             │                 │               │            │           │
 │──────────▶│              │                 │               │            │           │
 │           │ POST /suggest │                │               │            │           │
 │           │─────────────▶│                 │               │            │           │
 │           │              │ Build context   │               │            │           │
 │           │              │────────────────▶│               │            │           │
 │           │              │                 │ POST /discover-gaps         │           │
 │           │              │                 │ LLM gap analysis            │           │
 │           │              │                 │◀───────────── path JSON     │           │
 │           │              │                 │               │            │           │
 │           │              │                 │ GET /chunks-by-ids          │           │
 │           │              │                 │───────────────────────────▶│           │
 │           │              │                 │◀──────── chunks ───────────│           │
 │           │              │                 │               │            │           │
 │           │              │                 │ POST /suggest │            │           │
 │           │              │                 │ LLM generate  │            │           │
 │           │              │◀────────────────│ suggestions   │            │           │
 │           │◀─────────────│ Paths returned  │               │            │           │
 │◀──────────│              │                 │               │            │           │
 │           │              │                 │               │            │           │
 │ Select paths, Generate    │                 │               │            │           │
 │──────────▶│              │                 │               │            │           │
 │           │ POST /generate│                │               │            │           │
 │           │─────────────▶│                 │               │            │           │
 │           │              │────────────────▶│               │            │           │
 │           │              │                 │ RAG retrieve  │            │           │
 │           │              │                 │───────────────────────────▶│
 │           │              │                 │◀─── chunks ────────────────│
 │           │              │                 │ LLM generate  │            │           │
 │           │              │                 │ hierarchy JSON│            │           │
 │           │              │◀────────────────│               │            │           │
 │           │              │ Save BacklogHistory             │            │           │
 │           │              │────────────────────────────────▶│            │           │
 │           │◀─────────────│ Backlog JSON    │               │            │           │
 │◀──────────│              │                 │               │            │           │
 │           │              │                 │               │            │           │
 │ Edit backlog, Save        │                 │               │            │           │
 │──────────▶│              │                 │               │            │           │
 │           │ POST /save    │                 │               │            │           │
 │           │─────────────▶│                 │               │            │           │
 │           │              │ Validate hierarchy              │            │           │
 │           │              │ Create Epics───────────────────▶│            │           │
 │           │              │ Create Stories─────────────────▶│            │           │
 │           │              │ Update counts──────────────────▶│            │           │
 │           │              │ Socket.io emit                  │            │           │
 │           │◀─────────────│ Saved           │               │            │           │
 │◀──────────│              │                 │               │            │           │
 │           │              │                 │               │            │           │
 │ Push to Jira              │                 │               │            │           │
 │──────────▶│              │                 │               │            │           │
 │           │ POST /push    │                 │               │            │           │
 │           │─────────────▶│                 │               │            │           │
 │           │              │──────────────────────────────────────────────────────────▶│
 │           │              │ Create Epic──────────────────────────────────────────────▶│
 │           │              │◀─────── Epic key ─────────────────────────────────────────│
 │           │              │ Create Story (parent=epic_key)────────────────────────────▶│
 │           │              │◀─────── Story key ────────────────────────────────────────│
 │           │              │ Update story.jiraIssueKey ───▶│            │           │
 │           │◀─────────────│ Push complete   │               │            │           │
 │◀──────────│              │                 │               │            │           │
```

### 26.2 Authentication Flow (with OTP)

```
User        Frontend       Backend          MongoDB        SMTP/API
 │             │              │                 │               │
 │ Register    │              │                 │               │
 │────────────▶│              │                 │               │
 │             │ POST /register                │               │
 │             │─────────────▶│                 │               │
 │             │              │ validate input  │               │
 │             │              │ check AbstractAPI (email deliverability) │
 │             │              │──────────────────────────────────────────▶│
 │             │              │◀────── deliverable? ─────────────────────│
 │             │              │ findOne({email})│               │
 │             │              │───────────────▶│               │
 │             │              │◀── null (new) ─│               │
 │             │              │ create User     │               │
 │             │              │───────────────▶│               │
 │             │              │ send OTP email  │               │
 │             │              │──────────────────────────────────────────▶│
 │             │◀─────────────│ {requiresVerification: true}              │
 │◀────────────│              │                 │               │
 │             │              │                 │               │
 │ Check email, enter OTP     │                 │               │
 │────────────▶│              │                 │               │
 │             │ POST /verify-email             │               │
 │             │─────────────▶│                 │               │
 │             │              │ findOne({email})│               │
 │             │              │───────────────▶│               │
 │             │              │◀── user ───────│               │
 │             │              │ validate OTP    │               │
 │             │              │ set isEmailVerified = true      │
 │             │              │ generate JWT    │               │
 │             │◀─────────────│ {token, user}   │               │
 │◀────────────│              │                 │               │
```

---

## 27. Hidden Assumptions & Common Pitfalls

### 27.1 Hidden Assumptions

| Assumption | Reality Check |
|-----------|---------------|
| "First registered user is admin" | README says this but code doesn't enforce it; admin role requires explicit env config (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) or direct DB edit |
| "AI service is optional" | README states this but controllers return 503 errors if AI service is down — no mock fallback in active code paths |
| "Project requires Jira + GitHub at creation" | Hard validation in `createProject` requires both — user cannot create a project without both integrations configured |
| "Documents folder is ./uploads/" | Static file serving from `backend/uploads/` — must exist and be writable |
| "ChromaDB directory must exist" | Created automatically if missing, but path must be writable |
| "All stories belong to an epic" | Story model has `epic` as optional — stories can exist without epics, but generation always creates epics first |
| "Sprints are S1-S4 + backlog" | Hard-coded enum on Story model — cannot use custom sprint names |
| "ONNX model downloads on first use" | ~90MB download on first embedding call — can cause timeout if network is slow |
| "Email service is optional for dev" | Controllers handle missing SMTP gracefully, returning devOTP and devResetUrl |

### 27.2 Common Pitfalls

| Pitfall | How to Avoid |
|---------|-------------|
| **Forgetting to start all 3 services** | Use `npm run dev:all` from root |
| **Port conflicts (EADDRINUSE)** | Kill existing processes before starting; check with `netstat` or `lsof` |
| **CORS errors from wrong origin** | Only `localhost:5173-5176` and `FRONTEND_URL` are allowed; check Vite port |
| **MongoDB SRV DNS failure** | Set `MONGO_URI_DIRECT` as fallback for restricted networks |
| **OpenRouter 429 rate limits** | Free tier has strict limits; switch to paid key or DeepSeek |
| **Large PDFs timing out** | Set `AI_INGEST_TIMEOUT_MS` to 0 (no timeout) or increase to 300000 (5 min) |
| **ChromaDB lock errors** | Only one process can access ChromaDB at a time; stop all AI service instances before restart |
| **ONNX model download hanging** | First run needs internet; pre-download model if deploying offline |
| **Jira push order matters** | Epics MUST be created before stories that reference them; the controller handles this but custom scripts may not |
| **Story `project` field null** | `updateStory` checks for invalid project ref and returns 409 — stories orphaned during project deletion cause this |
| **Auth token not sent** | `api.js` interceptor reads from `authStore` — if store is reset, requests fail with 401 |

### 27.3 Developer Gotchas

1. **axios response unwrapping:** `api.js` response interceptor returns `response.data`, so page components call `api.get('/projects')` and receive `{success, data}` directly, NOT `{data: {success, data}}`.

2. **Story save endpoint expects `epics`, `stories`, `tasks`, `subtasks` keys** — NOT a single array. The BacklogEditor must send the hierarchy as four separate arrays.

3. **generateStories returns `issues[]` but saveGeneratedStories expects `epics[]/stories[]/tasks[]/subtasks[]`** — the AI service's `/generate` endpoint returns issues, but the backend `save` endpoint normalizes into separate arrays. The `generateStories` function in `aiService.js` returns the raw AI response — the frontend must handle the normalization.

4. **ChromaDB collection naming:** Collections are named with project UUIDs (e.g., `71f31e97_2d93_4b4a_bfb7_42fedfeeb8f2_chunks`). The `rag_service` finds collections by checking if the project_id (with hyphens replaced by underscores) appears in the collection name.

5. **Password field is `select: false`** — you must explicitly `.select('+password')` to include it in queries. The `login` function does this correctly; forgetting it will cause bcrypt.compare to fail on `undefined`.

6. **`toIdString` in projectController** handles multiple ID formats because the codebase stores IDs inconsistently (sometimes as ObjectId, sometimes as string). Always use this helper when comparing user IDs with project ownership.

7. **The `express-async-errors` package is loaded at the top of `server.js`** — it patches Express to handle async errors. If you create a new entry point or refactor the bootstrap, you must keep this import.

---

## 28. Prioritized Improvement Roadmap

### 28.1 Critical (P0) — Fix Within 1 Month

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | **Add automated tests** — Start with auth, project CRUD, story generation/save endpoints | 2 weeks | Prevents regression, enables safe refactoring |
| 2 | **Migrate JWT to httpOnly cookies** — Replace localStorage token with secure, httpOnly cookie + CSRF protection | 1 week | Fixes XSS vulnerability |
| 3 | **Split storyController.js** — Extract: suggestController, generateController, saveController, crudController | 3 days | Maintainability, testability |
| 4 | **Add missing database indexes** — Especially `Commit.projectId`, `Document.project+isActive+status`, `Story.project+type` | 2 hours | Major performance improvement |
| 5 | **Add input validation** — Use Joi or Zod schemas on all API endpoints | 1 week | Prevents data corruption, security |

### 28.2 High Priority (P1) — Fix Within 3 Months

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 6 | **Add pagination to all list endpoints** — Stories, documents, audit logs, commits | 2 days | Prevents OOM on large projects |
| 7 | **Add proper API documentation** — Swagger/OpenAPI on backend, customize FastAPI docs | 3 days | Developer experience |
| 8 | **Implement Redis for Socket.io** — Enable multi-instance backend scaling | 1 week | Horizontal scaling |
| 9 | **Remove dead code** — getMockStories, getMockSuggestions, unused three-step pipeline | 2 hours | Code clarity |
| 10 | **Standardize error response format** — All endpoints return `{success, message, data?, errors?}` consistently | 3 days | Client-side error handling |
| 11 | **Add file-based logging with rotation** — Winston file transport or ELK/Loki integration | 4 hours | Debugging, audit compliance |
| 12 | **Fix Commit model inconsistency** — Change `projectId` from String to ObjectId ref | 4 hours | Consistency, populate support |

### 28.3 Medium Priority (P2) — Fix Within 6 Months

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 13 | **Add TypeScript to frontend** — Incremental migration, starting with stores and API client | 2 weeks | Type safety, better IDE support |
| 14 | **Extract shared types** — Create shared schema package for frontend/backend model alignment | 1 week | Prevents type mismatches |
| 15 | **Containerize all services** — Docker + docker-compose for consistent dev/prod environments | 1 week | Deployment reliability |
| 16 | **Add CI/CD pipeline** — GitHub Actions for lint, test, build on PR | 3 days | Quality gate |
| 17 | **Implement feature flags** — Simple env-based flags for AI providers, features | 2 days | Safe rollout |
| 18 | **Wire up 3-step generation pipeline** — Activate the extract→format→critic pipeline as an optional "quality mode" | 3 days | Better AI output quality |
| 19 | **Add rate limiting to AI endpoints** — Prevent LLM cost overruns from rapid retries | 2 hours | Cost control |
| 20 | **Add health check dashboard** — Frontend page showing all service statuses | 2 days | Operations visibility |

### 28.4 Low Priority (P3) — Fix Within 12 Months

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 21 | **Migrate ChromaDB to server mode** — Enable multi-instance AI service scaling | 1 week | Production scaling |
| 22 | **Add comprehensive E2E tests** — Playwright tests for full user workflows | 2 weeks | Release confidence |
| 23 | **Implement proper audit trail** — Ensure ALL mutations create AuditLog entries | 1 week | Compliance |
| 24 | **Add data export/import** — Project backup/restore functionality | 1 week | Data portability |
| 25 | **Performance monitoring** — Add APM (DataDog/NewRelic/OpenTelemetry) instrumentation | 1 week | Production monitoring |
| 26 | **Internationalization (i18n)** — Framework setup for multi-language support | 2 weeks | Market expansion |
| 27 | **Plugin system for AI providers** — Make adding new LLM providers a config change, not code change | 2 weeks | Extensibility |
| 28 | **User-facing changelog** — In-app feature announcements and changelog | 3 days | User engagement |

### 28.5 Technical Debt Quick Wins (Can Do Any Friday)

- Replace `print()` with `logger.error()` in `rag_service.py` line 140
- Extract magic strings to constants file (sprint names, status enums, role names)
- Add ESLint/Prettier config and fix formatting inconsistencies
- Add `.editorconfig` for consistent editor settings
- Remove unused imports across the codebase
- Add JSDoc comments to all exported functions in `aiService.js`
- Rename `BacklogHistory` → `BacklogHistory` (typo in model name)
- Add `__pycache__` and `.pytest_cache` to `.gitignore`

---

## Appendices

### A. Glossary

| Term | Definition |
|------|-----------|
| SRS | Software Requirements Specification — the uploaded document containing project requirements |
| RAG | Retrieval Augmented Generation — technique of retrieving relevant document chunks before LLM generation |
| ChromaDB | Local vector database for storing document embeddings |
| ONNX | Open Neural Network Exchange — runtime for the embedding model |
| OTP | One-Time Password — 6-digit email verification code |
| SRV | DNS Service Record — used by MongoDB Atlas connection strings |
| Epic | A large body of work that can be broken down into stories |
| Story/Task/Subtask | Decreasing granularity of work items in the backlog hierarchy |
| Planning Path | A suggested direction for next work based on gap analysis |
| Requirement Map/Graph | Structured extraction of SRS requirements with dependencies |
| Backlog | The collection of all epics, stories, tasks, and subtasks for a project |

### B. Port Map

| Service | Default Port | Configurable Via |
|---------|-------------|-----------------|
| Frontend (Vite) | 5173 | vite.config.js |
| Backend (Express) | 5000 | PORT in .env |
| AI Service (FastAPI) | 8000 | PORT in .env |
| MongoDB Atlas | 27017 | In MONGO_URI |
| ChromaDB (local) | N/A (embedded) | CHROMA_PERSIST_DIR in .env |

### C. Quick Debugging Commands

```bash
# Check if AI service is healthy
curl http://localhost:8000/health

# Check if backend is running
curl http://localhost:5000/health

# Test MongoDB connection
node -e "require('./backend/src/config/db')()"

# Check ChromaDB collections
cd ai-service && python -c "
from services.rag_service import RAGService
from services.embeddings import EmbeddingService
es = EmbeddingService()
client = es._get_chroma_client()
print([c.name for c in client.list_collections()])
"

# Reset ChromaDB (dangerous, deletes all embeddings)
rm -rf ai-service/chroma_store/*

# Find process using a port
# Windows:
netstat -ano | findstr :5000
# Linux/Mac:
lsof -i :5000

# Kill process by PID
# Windows:
taskkill /PID <pid> /F
# Linux/Mac:
kill -9 <pid>
```

### D. Branch Strategy (Historical)

Based on commit history and deployment notes:
- `akshay` — Primary feature branch (dark mode, UI fixes)
- `tejas` — User.js and App.jsx fixes
- `avishkar` — Independent work
- `combined-work` — Integration branch
- `main` — Not actively used; development happens on feature branches

**Recommendation:** Adopt Git Flow or GitHub Flow with `main` as production, `develop` as integration, and feature branches for all work.

---

> **Documentation Maintainer:** Update this file when architecture changes, new services are added, or significant refactors occur.  
> **Last Updated:** 2026-06-27  
> **Next Review:** When v1.3.0 development begins