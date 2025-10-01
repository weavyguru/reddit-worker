import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import { createLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('JobManager');

export class JobManager {
  constructor() {
    this.jobs = new Map(); // jobId -> job data
    this.nextJobId = 1;
    this.subscribers = new Set(); // WebSocket connections to notify
  }

  /**
   * Subscribe to job updates
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Notify all subscribers of a job update
   */
  notifySubscribers(event) {
    this.subscribers.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        logger.error(`Failed to notify subscriber: ${error.message}`);
      }
    });
  }

  /**
   * Create a new job
   */
  createJob(channels, hours, days, testMode) {
    const jobId = this.nextJobId++;
    const job = {
      id: jobId,
      status: 'pending',
      channels: channels.map(ch => ({
        subreddit: ch.subreddit,
        status: 'pending',
        stats: null,
        error: null
      })),
      params: { hours, days, testMode },
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      totalStats: {
        posts: 0,
        comments: 0,
        successful: 0,
        failed: 0
      }
    };

    this.jobs.set(jobId, job);
    logger.info(`Created job ${jobId} with ${channels.length} channels`);

    this.notifySubscribers({
      type: 'job_created',
      job: this.getJobSummary(jobId)
    });

    return jobId;
  }

  /**
   * Start a job by running workers for all channels
   */
  async startJob(jobId, channels) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    logger.info(`Starting job ${jobId}`);

    this.notifySubscribers({
      type: 'job_started',
      job: this.getJobSummary(jobId)
    });

    const { hours, days, testMode } = job.params;

    // Start workers for each channel
    const workerPromises = channels.map((channel, index) =>
      this.runChannelWorker(jobId, index, channel, hours, days, testMode)
    );

    // Wait for all workers to complete
    await Promise.allSettled(workerPromises);

    // Update job status
    job.status = 'completed';
    job.completedAt = new Date().toISOString();

    // Calculate total stats
    job.channels.forEach(ch => {
      if (ch.stats) {
        job.totalStats.posts += ch.stats.posts;
        job.totalStats.comments += ch.stats.comments;
        job.totalStats.successful += ch.stats.successful;
        job.totalStats.failed += ch.stats.failed;
      }
    });

    logger.info(`Job ${jobId} completed`);

    this.notifySubscribers({
      type: 'job_completed',
      job: this.getJobSummary(jobId)
    });

    return job;
  }

  /**
   * Run a worker for a single channel
   */
  runChannelWorker(jobId, channelIndex, channel, hours, days, testMode) {
    return new Promise((resolve, reject) => {
      const job = this.jobs.get(jobId);
      const workerPath = path.join(__dirname, '../workers', 'channelWorker.js');

      const worker = new Worker(workerPath, {
        workerData: {
          clientId: channel.clientId,
          clientSecret: channel.clientSecret,
          subreddit: channel.subreddit,
          hours,
          days,
          testMode
        }
      });

      worker.on('message', (message) => {
        switch (message.type) {
          case 'progress':
            job.channels[channelIndex].status = message.status;
            if (message.postsCount) {
              job.channels[channelIndex].postsCount = message.postsCount;
            }

            this.notifySubscribers({
              type: 'channel_progress',
              jobId,
              subreddit: message.subreddit,
              status: message.status,
              postsCount: message.postsCount
            });
            break;

          case 'complete':
            job.channels[channelIndex].status = 'completed';
            job.channels[channelIndex].stats = message.stats;

            this.notifySubscribers({
              type: 'channel_completed',
              jobId,
              subreddit: message.subreddit,
              stats: message.stats
            });
            break;

          case 'error':
            job.channels[channelIndex].status = 'failed';
            job.channels[channelIndex].error = message.error;

            this.notifySubscribers({
              type: 'channel_error',
              jobId,
              subreddit: message.subreddit,
              error: message.error
            });
            break;
        }
      });

      worker.on('error', (error) => {
        job.channels[channelIndex].status = 'failed';
        job.channels[channelIndex].error = error.message;
        reject(error);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && job.channels[channelIndex].status !== 'completed') {
          job.channels[channelIndex].status = 'failed';
          job.channels[channelIndex].error = `Worker stopped with exit code ${code}`;
        }
        resolve();
      });
    });
  }

  /**
   * Get a summary of a job
   */
  getJobSummary(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return {
      id: job.id,
      status: job.status,
      channels: job.channels,
      params: job.params,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      totalStats: job.totalStats
    };
  }

  /**
   * Get all jobs
   */
  getAllJobs() {
    return Array.from(this.jobs.values()).map(job => this.getJobSummary(job.id));
  }

  /**
   * Get active jobs (running or pending)
   */
  getActiveJobs() {
    return Array.from(this.jobs.values())
      .filter(job => job.status === 'running' || job.status === 'pending')
      .map(job => this.getJobSummary(job.id));
  }

  /**
   * Delete a job
   */
  deleteJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'running') {
      throw new Error('Cannot delete a running job');
    }

    this.jobs.delete(jobId);
    logger.info(`Deleted job ${jobId}`);

    this.notifySubscribers({
      type: 'job_deleted',
      jobId
    });

    return true;
  }
}
