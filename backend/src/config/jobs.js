/**
 * Scheduled Job Runner
 * Initializes and manages all background jobs (cron, intervals, etc.)
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const SprintService = require('../services/sprintService');

class JobRunner {
  static jobs = [];

  /**
   * Initialize all scheduled jobs
   */
  static initialize(io = null) {
    try {
      logger.info('Initializing scheduled jobs...');

      // Sprint auto-closure job: runs every hour
      const sprintAutoCloseJob = cron.schedule(
        '0 * * * *', // Every hour at minute 0
        async () => {
          logger.debug('Running sprint auto-closure job...');
          try {
            const result = await SprintService.autoCloseSprints(io);
            if (result.closed > 0 || result.errors > 0) {
              logger.info(`Sprint auto-closure: ${result.closed} closed, ${result.errors} errors`);
            }
          } catch (error) {
            logger.error(`Sprint auto-closure job error: ${error.message}`);
          }
        },
        {
          scheduled: true,
        }
      );

      this.jobs.push({
        name: 'sprintAutoClosure',
        schedule: '0 * * * * (hourly)',
        job: sprintAutoCloseJob,
      });

      logger.info(
        `Successfully initialized ${this.jobs.length} scheduled job(s):` +
        `${this.jobs.map(j => ` ${j.name}@${j.schedule}`).join(',')}`
      );

      return this.jobs;
    } catch (error) {
      logger.error(`Failed to initialize jobs: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Stop all scheduled jobs
   */
  static stopAll() {
    this.jobs.forEach(jobEntry => {
      jobEntry.job.stop();
      logger.info(`Stopped job: ${jobEntry.name}`);
    });
    this.jobs = [];
  }

  /**
   * Get status of all jobs
   */
  static getStatus() {
    return this.jobs.map(j => ({
      name: j.name,
      schedule: j.schedule,
      running: !j.job._destroyed,
    }));
  }
}

module.exports = JobRunner;
