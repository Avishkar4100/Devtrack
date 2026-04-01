/**
 * GitHub Validation Service
 * Validates GitHub connections, tokens, repositories, and API health
 */

const axios = require('axios');
const logger = require('../config/logger');

class GitHubValidator {
  /**
   * Validate GitHub personal access token
   * Checks: token format, API access, scopes
   */
  static async validateToken(token) {
    if (!token || typeof token !== 'string' || token.length < 20) {
      return {
        valid: false,
        error: 'Invalid token format. Token too short or missing.',
      };
    }

    try {
      const headers = { Authorization: `token ${token}`, 'User-Agent': 'DevTrack' };
      const response = await axios.get('https://api.github.com/user', { headers });
      
      return {
        valid: true,
        user: response.data.login,
        name: response.data.name,
        email: response.data.email,
        scopes: response.headers['x-oauth-scopes']?.split(', ') || [],
      };
    } catch (error) {
      if (error.response?.status === 401) {
        return { valid: false, error: 'Token is invalid or expired.' };
      }
      if (error.response?.status === 403) {
        return { valid: false, error: 'Token is revoked or has insufficient permissions.' };
      }
      return { valid: false, error: `GitHub API error: ${error.message}` };
    }
  }

  /**
   * Validate repository access
   * Checks: repo exists, user has access, repo is not archived
   */
  static async validateRepository(token, repoFullName) {
    if (!repoFullName || !repoFullName.includes('/')) {
      return { valid: false, error: 'Repository must be in format: owner/repo' };
    }

    try {
      const headers = { Authorization: `token ${token}`, 'User-Agent': 'DevTrack' };
      const response = await axios.get(`https://api.github.com/repos/${repoFullName}`, { 
        headers,
        timeout: 5000,
      });

      const repo = response.data;

      // Validation checks
      if (repo.archived) {
        return { valid: false, error: 'Repository is archived and cannot be used.' };
      }

      if (!repo.permissions?.push && !repo.permissions?.admin) {
        return { valid: false, error: 'You do not have write access to this repository.' };
      }

      return {
        valid: true,
        repo: {
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          private: repo.private,
          owner: repo.owner.login,
          url: repo.html_url,
          language: repo.language,
          stars: repo.stargazers_count,
          archived: repo.archived,
          defaultBranch: repo.default_branch,
        },
        permissions: {
          admin: repo.permissions.admin,
          push: repo.permissions.push,
          pull: repo.permissions.pull,
        },
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return { valid: false, error: 'Repository not found. Check the name and try again.' };
      }
      if (error.response?.status === 403) {
        return { valid: false, error: 'Access denied. Check your token permissions.' };
      }
      return { valid: false, error: `Validation failed: ${error.message}` };
    }
  }

  /**
   * Validate branch exists in repository
   * Checks: branch exists, is accessible
   */
  static async validateBranch(token, repoFullName, branchName) {
    if (!branchName || typeof branchName !== 'string') {
      return { valid: false, error: 'Branch name is required.' };
    }

    try {
      const headers = { Authorization: `token ${token}`, 'User-Agent': 'DevTrack' };
      const response = await axios.get(
        `https://api.github.com/repos/${repoFullName}/branches/${branchName}`,
        { headers, timeout: 5000 }
      );

      return {
        valid: true,
        branch: {
          name: response.data.name,
          commit: response.data.commit.sha.slice(0, 7),
          protected: response.data.protected,
        },
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return { valid: false, error: `Branch "${branchName}" not found in repository.` };
      }
      return { valid: false, error: `Branch validation failed: ${error.message}` };
    }
  }

  /**
   * Check GitHub API rate limits
   * Returns remaining API calls and reset time
   */
  static async checkRateLimit(token) {
    try {
      const headers = { Authorization: `token ${token}`, 'User-Agent': 'DevTrack' };
      const response = await axios.get('https://api.github.com/rate_limit', { 
        headers,
        timeout: 5000,
      });

      const core = response.data.rate_limit.core;
      const resetDate = new Date(core.reset * 1000);

      return {
        valid: true,
        limits: {
          limit: core.limit,
          remaining: core.remaining,
          used: core.limit - core.remaining,
          percentUsed: Math.round(((core.limit - core.remaining) / core.limit) * 100),
          resetTime: resetDate.toISOString(),
          resetIn: `${Math.round((core.reset * 1000 - Date.now()) / 1000 / 60)} minutes`,
        },
        warning: core.remaining < 100,
      };
    } catch (error) {
      return {
        valid: false,
        error: `Rate limit check failed: ${error.message}`,
      };
    }
  }

  /**
   * Get list of repositories accessible to user
   * Filters active, non-archived repos
   */
  static async getAccessibleRepositories(token, limit = 20) {
    try {
      const headers = { Authorization: `token ${token}`, 'User-Agent': 'DevTrack' };
      const response = await axios.get(
        `https://api.github.com/user/repos?sort=updated&per_page=${limit}&type=owner`,
        { headers, timeout: 10000 }
      );

      const repos = response.data
        .filter((repo) => !repo.archived && (repo.permissions?.push || repo.permissions?.admin))
        .map((repo) => ({
          name: repo.name,
          fullName: repo.full_name,
          url: repo.html_url,
          private: repo.private,
          language: repo.language,
          stars: repo.stargazers_count,
          updatedAt: repo.updated_at,
          defaultBranch: repo.default_branch,
        }));

      return {
        valid: true,
        repositories: repos,
        total: repos.length,
      };
    } catch (error) {
      return {
        valid: false,
        error: `Failed to get repositories: ${error.message}`,
      };
    }
  }

  /**
   * Test webhook delivery
   * Checks webhook endpoint accessibility and receives events
   */
  static async testWebhook(token, repoFullName, webhookUrl) {
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      return {
        valid: false,
        error: 'Webhook URL must be a valid HTTP/HTTPS endpoint.',
      };
    }

    try {
      const headers = { Authorization: `token ${token}`, 'User-Agent': 'DevTrack' };
      
      // Check if webhook test endpoint is accessible
      const testResponse = await axios.post(
        webhookUrl,
        {
          action: 'test',
          repository: { full_name: repoFullName },
          pusher: { name: 'DevTrack-Test' },
          timestamp: new Date().toISOString(),
        },
        { timeout: 5000 }
      );

      return {
        valid: true,
        message: 'Webhook test successful. Ready to receive push events.',
        responseStatus: testResponse.status,
      };
    } catch (error) {
      return {
        valid: false,
        error: `Webhook test failed: ${error.message}. Ensure URL is publicly accessible.`,
      };
    }
  }

  /**
   * Full connection validation
   * Runs all checks and returns comprehensive status
   */
  static async validateFullConnection(token, repoFullName, branchName = 'main') {
    const results = {
      token: null,
      repository: null,
      branch: null,
      rateLimit: null,
      allValid: false,
    };

    // 1. Validate token
    results.token = await this.validateToken(token);
    if (!results.token.valid) {
      results.allValid = false;
      return results;
    }

    // 2. Validate repository
    results.repository = await this.validateRepository(token, repoFullName);
    if (!results.repository.valid) {
      results.allValid = false;
      return results;
    }

    // 3. Validate branch
    results.branch = await this.validateBranch(token, repoFullName, branchName);
    if (!results.branch.valid) {
      results.allValid = false;
      return results;
    }

    // 4. Check rate limits
    results.rateLimit = await this.checkRateLimit(token);

    results.allValid = true;
    return results;
  }
}

module.exports = GitHubValidator;
