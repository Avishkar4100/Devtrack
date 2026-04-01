# GitHub Validation & Integration Guide

## Overview

Comprehensive GitHub validation system ensuring secure connections, proper permissions, and optimal API usage for code analysis and story tracking.

## Features

### 1. Token Validation
- **Validates**: Token format, expiration, scopes
- **Returns**: User info, accessibility, scope restrictions
- **Error Handling**: Clear messages for expired/revoked tokens

### 2. Repository Validation  
- **Checks**: Repo exists, user has access, not archived
- **Returns**: Repo metadata (name, owner, language, stars, branch)
- **Permissions**: Verifies push/admin access required

### 3. Branch Validation
- **Validates**: Branch exists in repo, is protected
- **Returns**: Branch info (name, latest commit SHA, protection status)
- **Error Handling**: Detects missing/inaccessible branches

### 4. Rate Limit Monitoring
- **Tracks**: API call usage, remaining calls, reset time
- **Warnings**: Alerts if usage > 80%+ of limit
- **Prevents**: Rate limit exceeded errors

### 5. Repository Discovery
- **Lists**: All accessible repos user can push to
- **Filters**: Active repos (not archived), filters forks
- **Sorting**: By last update, includes stars/language/url

### 6. Connection Validation
- **Full Test**: Validates token → repo → branch → rate limit
- **One-Step Verification**: Comprehensive health check
- **Stops on First Failure**: Efficient error detection

### 7. Health Check
- **Monitors**: Token validity and API rate limit status
- **Real-Time**: Check anytime for connection health
- **Alerts**: Warnings if approaching rate limits

## API Endpoints

### Token Validation
**POST** `/api/github/validate-token`
```json
{
  "token": "ghp_xxxxxxxxxxxx"
}
```
**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "valid": true,
    "user": "octocat",
    "name": "The Octocat",
    "email": "octocat@github.com",
    "scopes": ["repo", "user"]
  }
}
```

### Repository Validation
**POST** `/api/github/validate-repo`
```json
{
  "repo": "octocat/Hello-World"
}
```
**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "valid": true,
    "repo": {
      "name": "Hello-World",
      "fullName": "octocat/Hello-World",
      "description": "Project...",
      "private": false,
      "owner": "octocat",
      "url": "https://github.com/octocat/Hello-World",
      "language": "Ruby",
      "stars": 1234,
      "archived": false,
      "defaultBranch": "main"
    },
    "permissions": {
      "admin": true,
      "push": true,
      "pull": true
    }
  }
}
```

### Branch Validation
**POST** `/api/github/validate-branch`
```json
{
  "repo": "octocat/Hello-World",
  "branch": "main"
}
```
**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "valid": true,
    "branch": {
      "name": "main",
      "commit": "a1b2c3d",
      "protected": true
    }
  }
}
```

### Rate Limit Check
**GET** `/api/github/rate-limit`
**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "valid": true,
    "limits": {
      "limit": 5000,
      "remaining": 4850,
      "used": 150,
      "percentUsed": 3,
      "resetTime": "2026-04-01T00:00:00.000Z",
      "resetIn": "45 minutes",
      "warning": false
    }
  }
}
```

### Get Repositories
**GET** `/api/github/repositories`
**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "valid": true,
    "repositories": [
      {
        "name": "Hello-World",
        "fullName": "octocat/Hello-World",
        "url": "https://github.com/octocat/Hello-World",
        "private": false,
        "language": "Ruby",
        "stars": 1234,
        "updatedAt": "2026-03-31T10:00:00.000Z",
        "defaultBranch": "main"
      }
    ],
    "total": 5
  }
}
```

### Full Connection Validation
**POST** `/api/github/validate-connection`
```json
{
  "repo": "octocat/Hello-World",
  "branch": "main"
}
```
**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "allValid": true,
    "token": { "valid": true, "user": "octocat", ... },
    "repository": { "valid": true, "repo": { ... }, ... },
    "branch": { "valid": true, "branch": { ... } },
    "rateLimit": { "valid": true, "limits": { ... } }
  }
}
```

### Health Check
**GET** `/api/github/health`
**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-03-31T10:30:00.000Z",
    "token": { "valid": true, "user": "octocat" },
    "rateLimit": { "valid": true, "limits": { "remaining": 4850 } }
  }
}
```

## Service Implementation

### GitHubValidator Class

Located in `backend/src/services/githubValidator.js`

#### Methods

**validateToken(token)**
- Validates personal access token
- Returns: {valid, user, name, email, scopes} or {valid, error}

**validateRepository(token, repoFullName)**
- Validates repo access and permissions
- Returns: {valid, repo, permissions} or {valid, error}

**validateBranch(token, repoFullName, branchName)**
- Validates branch existence
- Returns: {valid, branch} or {valid, error}

**checkRateLimit(token)**
- Checks API rate limit status
- Returns: {valid, limits} or {valid, error}

**getAccessibleRepositories(token, limit)**
- Gets list of accessible repos
- Returns: {valid, repositories, total} or {valid, error}

**validateFullConnection(token, repo, branch)**
- Runs all validations in sequence
- Returns: {allValid, token, repository, branch, rateLimit}

## Error Responses

### 400 - Invalid Request
```json
{
  "success": false,
  "message": "Valid error message explaining the issue"
}
```
Common errors:
- "Invalid token format"
- "Repository not found"
- "You do not have write access"
- "Branch not found"

### 401 - Unauthorized
```json
{
  "success": false,
  "message": "GitHub token is not configured or invalid"
}
```

### 403 - Forbidden
```json
{
  "success": false,
  "message": "Access denied - check token permissions"
}
```

### 500 - Server Error
```json
{
  "success": false,
  "message": "GitHub API error or connection issue"
}
```

## Implementation Details

### Authentication
All endpoints (except webhook) require Firebase/JWT authentication
Token passed as `Authorization: Bearer <token>` header

### Rate Limiting
- GitHub API: 5000 requests/hour for authenticated users
- DevTrack checks before operations
- Warnings at 80% usage
- Graceful degradation when limit approached

### Error Handling
- **Token Validation**: Clear indicators for expired/revoked tokens
- **Repo Validation**: Differentiates "not found" vs "access denied"
- **Branch Validation**: Suggests default branch if specified doesn't exist
- **Rate Limits**: Shows exact reset time and remaining calls
- **Timeouts**: 5-10 seconds per API call to prevent hangs

### Security
- Token validation before any operations
- No token storage (uses user's stored token)
- Rate limit checking to prevent abuse
- Error messages don't expose internal data
- Webhook signature verification (SHA256)

## Usage Patterns

### 1. Initial Setup
```bash
# 1. User provides GitHub token
POST /api/github/validate-token

# 2. System lists available repos
GET /api/github/repositories

# 3. User selects repo and branch  
POST /api/github/validate-connection

# 4. Connect on project
POST /api/github/connect/:projectId
```

### 2. Health Checks
```bash
# Regular health monitoring
GET /api/github/health

# Check rate limit before bulk operations
GET /api/github/rate-limit
```

### 3. Code Analysis
```bash
# Validate setup before analysis
POST /api/github/validate-connection

# Trigger analysis
POST /api/github/analyze/:projectId
```

## Configuration Requirements

### Environment Variables
```bash
# Optional: Default GitHub repo (fallback)
GITHUB_REPO_OWNER=myorg
GITHUB_REPO_NAME=my-project

# Webhook webhook secret (for signature verification)
GITHUB_WEBHOOK_SECRET=secret_string

# Frontend URL (for user-facing links)
FRONTEND_URL=http://localhost:5173
```

### GitHub Personal Access Token
Required permissions:
- `repo` - Full control of private repositories
- `user` - Read user profile data
- `read:org` - Read organization data

## Testing

### Test Token Validation
```bash
curl -X POST http://localhost:5000/api/github/validate-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {user-token}" \
  -d '{"token":"ghp_xxxxxxxxxxxx"}'
```

### Test Repository Validation  
```bash
curl -X POST http://localhost:5000/api/github/validate-repo \
  -H "Authorization: Bearer {user-token}" \
  -d '{"repo":"octocat/Hello-World"}'
```

### Test Full Connection
```bash
curl -X POST http://localhost:5000/api/github/validate-connection \
  -H "Authorization: Bearer {user-token}" \
  -d '{"repo":"octocat/Hello-World","branch":"main"}'
```

### Test Health Check
```bash
curl -X GET http://localhost:5000/api/github/health \
  -H "Authorization: Bearer {user-token}"
```

## Troubleshooting

### 401 - Token Invalid
- Token expired or revoked
- Solution: Generate new token from GitHub settings
- Check token permissions include `repo` scope

### 403 - No Permission
- User lacks write access to repository
- Solution: Ensure user is repo collaborator with push access
- Check token has correct scope

### 404 - Not Found
- Repository not accessible to user
- Branch doesn't exist
- Solution: Verify repo name (case-sensitive), check default branch

### Rate Limit Warning
- User exceeded 80% of API usage
- Solution: Wait for rate limit reset
- Use fewer API calls per analysis

## Future Enhancements

- [ ] Webhook auto-setup (automatic registration on GitHub)
- [ ] Commit metadata caching (reduce API calls)
- [ ] OAuth2 flow for token management
- [ ] Multiple repo support per project
- [ ] PR/branch protection validation
- [ ] Commit signing verification
- [ ] Code scan integration (GitHub security features)
- [ ] Custom webhook events filtering

## Related Features

- **Code Analysis**: Integrates with aiService for code review
- **Story Tracking**: Links commits to stories for progress tracking
- **Webhooks**: Automatic push event detection and processing
- **Commits**: Persists commit metadata for audit trail

## Files Modified/Created

- `backend/src/services/githubValidator.js` - NEW: Validation service
- `backend/src/controllers/githubController.js` - Added 7 validation endpoints
- `backend/src/routes/github.js` - Added validation routes
