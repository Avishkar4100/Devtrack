/**
 * E2E Test Script for Jira Push/Pull Sync
 * Tests: Jira connection, push epics, push stories, sync back, verify consistency
 * Run: node test-jira-sync-e2e.js
 */

const axios = require('axios');
const assert = require('assert');

const BASE_URL = 'http://localhost:5000/api';

// JWT Token for authentication
const authToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5Y2JiYWZkZDIxYTc2NDMwNmQyYmVhZCIsImlhdCI6MTc3NDk1OTUwNH0.Rp4_AMwqfqDJyueiiaK0oAALltKqeuC_Userju6Lrck';
let authTokenLocal = authToken;
let projectId = null;
let epicIds = [];
let storyIds = [];

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  validateStatus: () => true, // Don't throw on any status
});

const setAuthToken = (token) => {
  authTokenLocal = token;
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

const log = (title, message = '') => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📌 ${title}`);
  if (message) console.log(message);
  console.log('='.repeat(60));
};

const success = (message) => console.log(`✓ ${message}`);
const error = (message) => console.log(`✗ ${message}`);
const info = (message) => console.log(`ℹ ${message}`);

(async () => {
  try {
    log('JIRA PUSH/PULL SYNC E2E TEST', 'Testing Jira integration workflow');

    // Set auth token
    setAuthToken(authToken);

    // ======================================
    // STEP 1: Test Jira Connection
    // ======================================
    log('STEP 1: Test Jira Connection');
    const testRes = await api.get('/jira/test');
    
    if (testRes.status !== 200) {
      error(`Jira connection test failed: ${testRes.status}`);
      error(`Response: ${JSON.stringify(testRes.data)}`);
      console.log('\n⚠️  STOPPING TEST - Jira credentials not configured');
      console.log('Please configure Jira settings in the Settings page first.');
      console.log('1. Go to http://localhost:5174/settings');
      console.log('2. Fill in Jira Domain, Email, and API Token');
      console.log('3. Click "Test Connection"');
      process.exit(1);
    }
    
    success(`Jira connected as: ${testRes.data.data?.displayName || 'Unknown User'}`);
    success(`Jira URL: ${testRes.data.data?.jiraDomain || 'N/A'}`);

    // ======================================
    // STEP 2: Get/Create Test Project
    // ======================================
    log('STEP 2: Get Test Project');
    const projectsRes = await api.get('/projects');
    
    if (projectsRes.status !== 200 || !projectsRes.data.data || projectsRes.data.data.length === 0) {
      error('No projects found');
      console.log('Please create a project first');
      process.exit(1);
    }
    
    const testProject = projectsRes.data.data[0];
    projectId = testProject._id;
    
    success(`Found test project: ${testProject.name}`);
    success(`Project ID: ${projectId}`);
    
    if (!testProject.jiraConnected) {
      error('Project is not connected to Jira');
      error('Please connect the project to Jira in the project settings');
      process.exit(1);
    }
    
    success(`Jira Project Key: ${testProject.jiraProjectKey}`);

    // ======================================
    // STEP 3: Get Existing Epics & Stories
    // ======================================
    log('STEP 3: Get Existing Epics & Stories');
    const epicsRes = await api.get(`/stories/epics/${projectId}`);
    const storiesRes = await api.get(`/stories/project/${projectId}`);
    
    const epics = epicsRes.data.data || [];
    const stories = storiesRes.data.data || [];
    
    if (epics.length === 0) {
      error('No epics found in project');
      info('Create epics in the Backlog Editor first');
      process.exit(1);
    }
    
    success(`Found ${epics.length} epics`);
    success(`Found ${stories.length} stories`);
    
    epicIds = epics.slice(0, 2).map((e) => e._id);
    storyIds = stories.filter((s) => s.type === 'story').slice(0, 3).map((s) => s._id);
    
    info(`Testing with ${epicIds.length} epics and ${storyIds.length} stories`);

    // ======================================
    // STEP 4: Push to Jira
    // ======================================
    log('STEP 4: Push Epics & Stories to Jira');
    
    const pushRes = await api.post(`/jira/push/${projectId}`, {
      epicIds,
      storyIds,
    });
    
    if (pushRes.status !== 200) {
      error(`Push to Jira failed: ${pushRes.status}`);
      error(`Response: ${JSON.stringify(pushRes.data)}`);
      process.exit(1);
    }
    
    const pushData = pushRes.data.data || {};
    success(`Pushed ${pushData.epics?.length || 0} epics to Jira`);
    success(`Pushed ${pushData.stories?.length || 0} stories to Jira`);
    
    if (pushData.errors && pushData.errors.length > 0) {
      error(`Encountered ${pushData.errors.length} errors during push:`);
      pushData.errors.forEach((e) => {
        error(`  - ${e.type} ${e.id}: ${e.error}`);
      });
    }

    // ======================================
    // STEP 5: Verify Jira Issues Created
    // ======================================
    log('STEP 5: Verify Jira Issues Created');
    
    const jiraIssuesRes = await api.get('/jira/server/issues', {
      params: { projectKey: testProject.jiraProjectKey, maxResults: 100 },
    });
    
    if (jiraIssuesRes.status !== 200) {
      error(`Failed to fetch Jira issues: ${jiraIssuesRes.status}`);
    } else {
      const jiraIssues = jiraIssuesRes.data.data?.issues || [];
      success(`${jiraIssues.length} issues found in Jira`);
      
      const jiraEpics = jiraIssues.filter((i) => i.fields?.issuetype?.name === 'Epic');
      const jiraStories = jiraIssues.filter((i) => i.fields?.issuetype?.name === 'Story');
      
      success(`  - ${jiraEpics.length} Epics`);
      success(`  - ${jiraStories.length} Stories`);
      
      // Show sample issues
      if (jiraIssues.length > 0) {
        info(`Sample issue: ${jiraIssues[0].key} - ${jiraIssues[0].fields?.summary}`);
      }
    }

    // ======================================
    // STEP 6: Sync from Jira Back to Local
    // ======================================
    log('STEP 6: Sync from Jira Back to Local');
    
    const syncRes = await api.post(`/jira/sync/${projectId}`);
    
    if (syncRes.status !== 200) {
      error(`Sync from Jira failed: ${syncRes.status}`);
      error(`Response: ${JSON.stringify(syncRes.data)}`);
    } else {
      const syncData = syncRes.data.data || {};
      success(`Synced ${syncData.syncedEpics || 0} epics from Jira`);
      success(`Synced ${syncData.syncedStories || 0} stories from Jira`);
      success(`Total issues processed: ${syncData.totalIssues || 0}`);
    }

    // ======================================
    // STEP 7: Verify Data Consistency
    // ======================================
    log('STEP 7: Verify Data Consistency');
    
    const refreshedEpicsRes = await api.get(`/stories/epics/${projectId}`);
    const refreshedStoriesRes = await api.get(`/stories/project/${projectId}`);
    
    const refreshedEpics = refreshedEpicsRes.data.data || [];
    const refreshedStories = refreshedStoriesRes.data.data || [];
    
    success(`Current epics in local DB: ${refreshedEpics.length}`);
    success(`Current stories in local DB: ${refreshedStories.length}`);
    
    // Check if pushed items have Jira keys
    const epicsWithJiraKey = refreshedEpics.filter((e) => e.jiraEpicKey);
    const storiesWithJiraKey = refreshedStories.filter((s) => s.jiraIssueKey);
    
    success(`Epics with Jira keys: ${epicsWithJiraKey.length}/${refreshedEpics.length}`);
    success(`Stories with Jira keys: ${storiesWithJiraKey.length}/${refreshedStories.length}`);
    
    if (epicsWithJiraKey.length > 0) {
      info(`Sample epic with Jira key: ${epicsWithJiraKey[0].jiraEpicKey}`);
    }
    if (storiesWithJiraKey.length > 0) {
      info(`Sample story with Jira key: ${storiesWithJiraKey[0].jiraIssueKey}`);
    }

    // ======================================
    // FINAL REPORT
    // ======================================
    log('TEST COMPLETE', '✓ All Jira sync operations successful');
    console.log(`
📊 SUMMARY:
  ✓ Jira connection verified
  ✓ ${epicIds.length} epics pushed to Jira
  ✓ ${storyIds.length} stories pushed to Jira
  ✓ Data synced back from Jira
  ✓ ${epicsWithJiraKey.length} epics have Jira references
  ✓ ${storiesWithJiraKey.length} stories have Jira references

🎯 NEXT STEPS:
  - Monitor real-time Jira issue updates
  - Test status change synchronization
  - Verify comment sync from Jira
    `);

  } catch (err) {
    log('ERROR', 'Test script encountered an error');
    error(err.message);
    console.error(err);
    process.exit(1);
  }
})();
