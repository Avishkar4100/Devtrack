# WebSocket Real-Time Updates Implementation

## Overview
This document describes the WebSocket real-time update system for DevTrack, enabling live synchronization of story changes, sprint updates, and project notifications across all connected clients.

## Architecture

### Backend (Node.js + Socket.IO)

#### 1. Socket Service (`src/services/socketService.js`)
Centralized WebSocket event emitter with type-safe methods:
- `emitToProject(io, projectId, event, data)` - Base emit method
- `storyCreated()` - Emit when story is created
- `storyUpdated()` - Emit when story is modified
- `storyDeleted()` - Emit when story is deleted
- `storyAssigned()` - Emit when story is assigned to someone
- `storiesSaved()` - Emit bulk backlog save event
- `sprintUpdated()` - Emit sprint changes
- `notify()` - Generic notification event
- `projectSynced()` - Emit after Jira/GitHub sync

#### 2. Server Setup (`server.js`)
- Express HTTP server with Socket.IO
- CORS configured for frontend domain
- Project room isolation: `project:${projectId}`
- Auto-connect/disconnect handling

#### 3. Story Controller Integration
Events emitted at key API endpoints:
```javascript
// In storyController.js
- createStory() → SocketService.storyCreated()
- updateStory() → SocketService.storyUpdated() + SocketService.storyAssigned()
- deleteStory() → SocketService.storyDeleted()
- saveGeneratedStories() → SocketService.storiesSaved()
```

### Frontend (React + Socket.IO Client)

#### 1. Socket Client (`lib/socket.js`)
```javascript
getSocket() - Get or initialize Socket.IO client
connectSocket(projectId) - Connect and join project room
disconnectSocket(projectId) - Disconnect from project room
```

#### 2. Custom Hook: `useProjectSocket()` 
Listen to real-time events for a specific project:

```javascript
const { isConnected, events } = useProjectSocket(projectId, {
  onStoryCreated: (story) => {},
  onStoryUpdated: (story) => {},
  onStoryDeleted: (storyId) => {},
  onStoryAssigned: (story) => {},
  onStoriesSaved: (stats) => {},
  onSprintUpdated: (sprint) => {},
  onNotification: (notification) => {},
})
```

#### 3. Helper Hook: `useStoryUpdates()`
Simplified version for triggering data refetch:

```javascript
const { socketEvents, isConnected } = useStoryUpdates(projectId, (update) => {
  // Refetch data on: created, updated, deleted, bulk-saved
})
```

## Event Payload Format

All WebSocket events follow this envelope:
```javascript
{
  type: "story:created",           // Event type
  timestamp: "2026-03-31T...",    // ISO timestamp
  data: {
    id: "...",                     // Resource ID
    title: "...",                  // Resource title
    // ... additional fields
  }
}
```

## Usage Examples

### 1. Auto-refetch Dashboard Stats
```javascript
// In Dashboard.jsx
useProjectSocket(projectId, {
  onStoriesSaved: () => refetchOverview(),
  onStoryCreated: () => refetchStats(),
  onStoryUpdated: () => refetchStats(),
})
```

### 2. Live Backlog Updates
```javascript
// In BacklogEditor.jsx - Listen and refetch stories
useStoryUpdates(projectId, (update) => {
  if (update.type === 'bulk-saved') {
    refetchBacklog()
  }
})
```

### 3. Toast Notifications
```javascript
// Hook automatically shows toasts for notifications
useProjectSocket(projectId, {
  onNotification: (notification) => {
    // Auto-toasted based on notification.type
  }
})
```

### 4. Live Story Form Updates
```javascript
// In StoryDetail.jsx
useProjectSocket(projectId, {
  onStoryUpdated: (story) => {
    if (story.id === currentStoryId) {
      setStory(story) // Update form with latest data
    }
  }
})
```

## Event Types Reference

### Story Events
- **story:created** - New story created
  - Payload: `{ id, title, type, epic, assignee, status, priority, storyPoints }`

- **story:updated** - Story modified
  - Payload: `{ id, title, type, epic, assignee, status, priority, storyPoints, updatedAt }`

- **story:deleted** - Story removed
  - Payload: `{ id }`

- **story:assigned** - Story assigned to user
  - Payload: `{ id, title, assignee, assignedAt }`

### Bulk Events
- **stories:saved** - Backlog items saved (bulk)
  - Payload: `{ epicCount, storyCount, taskCount, subtaskCount, totalCount }`

### Sprint Events
- **sprint:updated** - Sprint modified
  - Payload: `{ id, name, status, startDate, dueDate, completionPercentage }`

### System Events
- **notification** - Generic notification
  - Payload: `{ message, type: 'success'|'error'|'warning'|'info', timestamp }`

- **project:synced** - Sync completed (Jira/GitHub)
  - Payload: `{ syncType: 'jira'|'github'|'full', stats, syncedAt }`

## Best Practices

1. **Always cleanup subscriptions**
   - `useProjectSocket` hook handles auto-cleanup
   - Call `disconnectSocket()` when leaving project view

2. **Avoid race conditions**
   - Use `useQuery` optimistic updates with WebSocket
   - Consider debouncing rapid updates

3. **User feedback**
   - Show connection status indicator
   - Toast notifications for key events
   - Optimistic UI updates before confirmation

4. **Error handling**
   - Log errors in SocketService
   - Graceful fallback to polling if needed
   - Retry logic for failed emissions

## Testing

```javascript
// Test with multiple tabs open
// Create story in one tab → See real-time update in others

// Test with slow network
// Throttle network to 300kb/s
// Verify events still arrive

// Test connection loss
// Disconnect WiFi/network → See "Offline" status
// Reconnect → Auto-rejoin room and sync
```

## Future Enhancements

- [ ] Cursor presence (see who's editing what)
- [ ] Collaborative editing locks
- [ ] Activity timeline feed
- [ ] Typing indicators
- [ ] Voice/video chat integration
- [ ] Conflict resolution for simultaneous edits
- [ ] Distributed state sync (CRDT)

## Troubleshooting

**WebSocket not connecting:**
- Check `FRONTEND_URL` in backend .env
- Verify CORS configuration
- Check browser console for SocketIO errors

**Events not emitting:**
- Verify `req.app.get('io')` returns valid instance
- Check project room subscription
- Monitor console for emission errors

**Memory leaks:**
- Ensure cleanup in useEffect return
- Remove listeners on component unmount
- Monitor connected clients in production

## Files Modified

- `backend/server.js` - Socket.IO initialization
- `backend/src/services/socketService.js` - NEW: Event service
- `backend/src/controllers/storyController.js` - Event emissions
- `frontend/src/lib/useProjectSocket.js` - NEW: React hook
- `frontend/src/pages/Dashboard.jsx` - Hook integration
- `frontend/src/lib/socket.js` - Existing socket client

## Related Documentation

- Socket.IO: https://socket.io/docs/
- React Hooks: https://react.dev/reference/react/hooks
- Project Architecture: See README.md
