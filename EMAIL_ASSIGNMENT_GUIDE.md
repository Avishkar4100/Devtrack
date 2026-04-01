# Email Assignment Notifications - Implementation Guide

## Overview

Comprehensive email notification system for story assignments, including single assignments, bulk assignments, and re-assignments with rich HTML templates and direct action buttons.

## Features

### 1. **Single Story Assignment**
- **Trigger**: When story's assignee field is changed
- **Recipient**: New assignee
- **Content**: Story details including epic, priority, due date, story points
- **Action**: "Open in DevTrack" button linking to dashboard

### 2. **Bulk Assignment**
- **Trigger**: POST `/api/stories/bulk-assign` endpoint
- **Recipient**: Single assignee receiving multiple stories
- **Content**: Summary cards showing total stories and points, list of first 5 stories
- **Notification**: WebSocket event to all project members

### 3. **Enhanced Email Templates**

#### storyAssignedEmail
```html
- Rich card layout with story details
- Color-coded priority badge
- Due date, story points, epic, assignee info
- Direct "Open in DevTrack" CTA button
- Tips section for better workflow
- Project name and reporter visibility
```

#### bulkAssignmentEmail
```html
- Summary cards (story count + total points)  
- List of assigned stories with points
- Show "N more stories" if > 5
- Tips for prioritization
- Bulk assignment context
```

## API Endpoints

### Single Assignment
**Method**: PUT `/api/stories/:id`
```javascript
{
  assignee: "userId"
}
```
**Response**: Updated story object
**Email**: Sent automatically if assignee changes

### Bulk Assignment
**Method**: POST `/api/stories/bulk-assign`
```javascript
{
  storyIds: ["id1", "id2", "id3"],
  assigneeId: "userId",
  projectId: "projectId"
}
```
**Response**:
```javascript
{
  success: true,
  message: "3 stories assigned to John Doe",
  data: {
    modifiedCount: 3,
    assignee: { name, email, ... }
  }
}
```

## Implementation Details

### Backend Controllers

#### storyController.js
- **updateStory()**: Enhanced to detect assignee changes and send emails with story details
- **bulkAssignStories()**: New endpoint handling bulk assignment with email notifications

#### Email Service (email.js)
- **storyAssignedEmail()**: Enhanced template with details parameter
- **bulkAssignmentEmail()**: New template for multiple assignments

### Notification Chain

1. **API Call**: Update/bulk-assign stories
2. **Email**: Send notification to assignee
3. **WebSocket**: Emit `story:assigned` event to all project members
4. **Dashboard**: Show real-time update notification

### Details Object
```javascript
{
  epicTitle: "Epic Name",
  priority: "high",        // highest, high, medium, low, lowest
  dueDate: "2026-04-15",
  storyPoints: 5
}
```

## Email Template Variables

### storyAssignedEmail Parameters
```javascript
storyAssignedEmail(
  storyTitle,      // "Build login form"
  assigneeName,    // "John Doe"
  projectName,     // "DevTrack"
  reporterName,    // "Jane Smith"
  details: {
    epicTitle: "Authentication",
    priority: "high",
    dueDate: "2026-04-15",
    storyPoints: 5
  }
)
```

### bulkAssignmentEmail Parameters
```javascript
bulkAssignmentEmail(
  assigneeName,                    // "John Doe"
  projectName,                     // "DevTrack"
  stories: [
    { title: "...", storyPoints: 3 },
    { title: "...", storyPoints: 5 },
    // ...
  ],
  reporterName                     // "Jane Smith"
)
```

## Features

### Single Assignment Email
- ✅ Full story details in card format
- ✅ Color-coded priority badge (red, orange, yellow, green, blue)
- ✅ Due date and story points
- ✅ Epic reference
- ✅ Reporter name (who assigned)
- ✅ Direct "Open in DevTrack" button
- ✅ Tips section
- ✅ Mobile responsive

### Bulk Assignment Email
- ✅ Summary line with story count
- ✅ Stat cards (stories count + total points)
- ✅ List of first 5 stories with points
- ✅ "+N more stories..." indicator for overflow
- ✅ Bulk context message
- ✅ Priority tips
- ✅ Mobile responsive

## WebSocket Integration

### Events Emitted

**story:assigned** - Broadcast to all project members
```javascript
{
  type: "story:assigned",
  timestamp: "2026-03-31T...",
  data: {
    id: "storyId",
    title: "Story Title",
    assignee: { name, email, ... },
    assignedAt: "2026-03-31T..."
  }
}
```

**notification** - Generic notification
```javascript
{
  type: "notification",
  timestamp: "2026-03-31T...",
  data: {
    message: "3 stories assigned to John Doe",
    type: "success"
  }
}
```

## Testing

### Single Assignment Email
```bash
# Update any story with a new assignee
curl -X PUT http://localhost:5000/api/stories/{id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{ "assignee": "new-user-id" }'

# Check inbox for assignment email
```

### Bulk Assignment Email
```bash
curl -X POST http://localhost:5000/api/stories/bulk-assign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "storyIds": ["id1", "id2", "id3"],
    "assigneeId": "user-id",
    "projectId": "project-id"
  }'

# Check inbox for bulk assignment email
```

## Configuration

### Environment Variables
```bash
# Email provider (from existing setup)
RESEND_API_KEY=your_resend_key
RESEND_FROM="DevTrack <onboarding@resend.dev>"
FRONTEND_URL=http://localhost:5173

# Or SMTP
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
```

## Best Practices

1. **Always include context**: Title, epic, priority shown in all emails
2. **Action buttons**: Direct links to stories/projects reduce friction
3. **Sender identification**: Reporter name builds accountability
4. **Summary for bulk**: Point totals help with prioritization
5. **Tips section**: Educate users on workflow with each email
6. **WebSocket sync**: Email + real-time updates create cohesive experience

## Related Features

- **WebSocket Real-Time**: See `WEBSOCKET_REALTIME.md`
- **Story Management**: See main README
- **Email Configuration**: Resend API with Gmail SMTP fallback

## Files Modified

- `backend/src/services/email.js` - Enhanced storyAssignedEmail, added bulkAssignmentEmail
- `backend/src/controllers/storyController.js` - Updated updateStory(), added bulkAssignStories()
- `backend/src/routes/stories.js` - Added POST /bulk-assign endpoint

## Future Enhancements

- [ ] Assignment templates (auto-assign based on role)
- [ ] Notification preferences per user
- [ ] Assignment change notifications (who took over your work)
- [ ] Escalation emails for overdue assignments
- [ ] Assignment analytics and metrics
- [ ] Slack/Teams integration for assignments
- [ ] Real-time mention notifications (@person)
