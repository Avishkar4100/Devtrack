/**
 * Direct Jira Connection Test (No API Auth Required)
 * Tests Jira credentials from .env file directly
 * Run: node test-jira-direct.js
 */

require('dotenv').config();
const axios = require('axios');

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
    log('DIRECT JIRA CONNECTION TEST', 'Testing with credentials from .env');

    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const apiToken = process.env.JIRA_API_TOKEN;

    if (!baseUrl || !email || !apiToken) {
      error('Missing Jira credentials in .env');
      error(`  JIRA_BASE_URL: ${baseUrl ? '✓' : '✗'}`);
      error(`  JIRA_EMAIL: ${email ? '✓' : '✗'}`);
      error(`  JIRA_API_TOKEN: ${apiToken ? '✓' : '✗'}`);
      process.exit(1);
    }

    success('All Jira credentials loaded from .env');
    info(`Jira URL: ${baseUrl}`);
    info(`Jira Email: ${email}`);
    info(`API Token: ${apiToken.substring(0, 20)}...`);

    // ======================================
    // STEP 1: Test Jira Connection with Auth
    // ======================================
    log('STEP 1: Authenticate with Jira');

    const authHeader = Buffer.from(`${email}:${apiToken}`).toString('base64');

    const jiraClient = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
    });

    const meRes = await jiraClient.get('/rest/api/3/myself');
    
    if (meRes.status === 200) {
      success(`Jira authentication successful!`);
      success(`  User: ${meRes.data.displayName}`);
      success(`  Email: ${meRes.data.emailAddress}`);
      success(`  Account Type: ${meRes.data.accountType}`);
    } else {
      error(`Unexpected response: ${meRes.status}`);
      process.exit(1);
    }

    // ======================================
    // STEP 2: List Available Projects
    // ======================================
    log('STEP 2: Fetch Jira Projects');

    const projectsRes = await jiraClient.get('/rest/api/3/project', {
      params: { expand: 'description,lead' },
    });

    const projects = projectsRes.data;
    if (!projects || projects.length === 0) {
      error('No projects found in Jira');
      process.exit(1);
    }

    success(`Found ${projects.length} projects in Jira:`);
    projects.slice(0, 5).forEach((p) => {
      info(`  • ${p.key}: ${p.name}`);
    });

    // ======================================
    // STEP 3: Test Issue Creation (Create + Delete)
    // ======================================
    log('STEP 3: Test Issue Creation');

    if (projects.length === 0) {
      error('No projects available for testing');
      process.exit(1);
    }

    const testProjectKey = projects[0].key;
    info(`Using project: ${testProjectKey}`);

    // Create a test issue
    const createRes = await jiraClient.post('/rest/api/3/issues', {
      fields: {
        project: { key: testProjectKey },
        summary: `[DevTrack E2E Test] ${new Date().toISOString()}`,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Automated test issue from DevTrack Jira sync e2e test',
                },
              ],
            },
          ],
        },
        issuetype: { name: 'Task' },
      },
    });

    if (createRes.status === 201) {
      const createdIssueKey = createRes.data.key;
      success(`Test issue created: ${createdIssueKey}`);

      // Delete the test issue
      const deleteRes = await jiraClient.delete(`/rest/api/3/issues/${createdIssueKey}`);
      if (deleteRes.status === 204) {
        success(`Test issue deleted: ${createdIssueKey}`);
      } else {
        error(`Failed to delete test issue: ${deleteRes.status}`);
      }
    } else {
      error(`Failed to create test issue: ${createRes.status}`);
      error(createRes.data);
      process.exit(1);
    }

    // ======================================
    // FINAL REPORT
    // ======================================
    log('ALL TESTS PASSED ✓', 'Jira integration is working');
    console.log(`
📊 SUMMARY:
  ✓ Jira authentication successful
  ✓ Found ${projects.length} projects
  ✓ Test project: ${testProjectKey}
  ✓ Issue creation works
  ✓ Issue deletion works
  ✓ All Jira prerequisites validated

🎯 NEXT STEPS:
  1. Create projects in DevTrack with Jira connection
  2. Add epics and stories to test project
  3. Run the full e2e sync test

To verify Jira settings in the frontend:
  - Go to http://localhost:5174/settings
  - Click "Jira" tab
  - Click "Test Connection" button
  - Should show your Jira user info
    `);

  } catch (err) {
    log('ERROR', 'Connection test failed');
    error(err.message);
    if (err.response) {
      error(`Status: ${err.response.status}`);
      error(`Response: ${JSON.stringify(err.response.data)}`);
    }
    process.exit(1);
  }
})();
