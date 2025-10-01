#!/usr/bin/env node

import { Worker } from 'worker_threads';
import { Command } from 'commander';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import pLimit from 'p-limit';
import { loadChannelsConfig, getEnabledChannels } from './config/loader.js';
import { createLogger } from './utils/logger.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('Main');

/**
 * Create and run a worker for a channel
 */
function runChannelWorker(channel, hours, days, testMode) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'workers', 'channelWorker.js');

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

    const result = {
      subreddit: channel.subreddit,
      success: false,
      stats: null,
      error: null
    };

    worker.on('message', (message) => {
      switch (message.type) {
        case 'progress':
          logger.info(`[${message.subreddit}] Status: ${message.status}${message.postsCount ? ` (${message.postsCount} posts)` : ''}`);
          break;

        case 'complete':
          result.success = true;
          result.stats = message.stats;
          logger.info(`[${message.subreddit}] Completed successfully`);
          break;

        case 'error':
          result.error = message.error;
          logger.error(`[${message.subreddit}] Error: ${message.error}`);
          break;
      }
    });

    worker.on('error', (error) => {
      result.error = error.message;
      logger.error(`[${channel.subreddit}] Worker error: ${error.message}`);
      reject(error);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && !result.error) {
        result.error = `Worker stopped with exit code ${code}`;
        reject(new Error(result.error));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Main execution function
 */
async function main() {
  const program = new Command();

  program
    .name('reddit-intelligence-daemon')
    .description('Fetch Reddit posts and ingest them into a vector database')
    .option('--hours <number>', 'Fetch posts from last N hours', parseInt)
    .option('--days <number>', 'Fetch posts from last N days', parseInt)
    .option('--test', 'Test mode (fetch max 5 posts per channel)')
    .option('--config <path>', 'Path to channels.json configuration file')
    .parse(process.argv);

  const options = program.opts();

  // Validate options
  if (!options.hours && !options.days) {
    logger.error('Error: Must specify either --hours or --days');
    process.exit(1);
  }

  if (options.hours && options.days) {
    logger.error('Error: Cannot specify both --hours and --days');
    process.exit(1);
  }

  if (options.hours && options.hours <= 0) {
    logger.error('Error: --hours must be a positive number');
    process.exit(1);
  }

  if (options.days && options.days <= 0) {
    logger.error('Error: --days must be a positive number');
    process.exit(1);
  }

  // Check for API token
  if (!process.env.VECTORDB_API_TOKEN) {
    logger.error('Error: VECTORDB_API_TOKEN environment variable is not set');
    logger.info('Please create a .env file with: VECTORDB_API_TOKEN=your_token_here');
    process.exit(1);
  }

  try {
    // Load configuration
    logger.info('Loading channel configuration...');
    const config = loadChannelsConfig(options.config);
    const channels = getEnabledChannels(config);

    if (channels.length === 0) {
      logger.warn('No enabled channels found in configuration');
      process.exit(0);
    }

    logger.info(`Found ${channels.length} enabled channels: ${channels.map(c => c.subreddit).join(', ')}`);

    // Log execution parameters
    const timeWindow = options.hours ? `${options.hours} hours` : `${options.days} days`;
    logger.info(`Fetching posts from last ${timeWindow}`);
    if (options.test) {
      logger.info('Test mode: limiting to 5 posts per channel');
    }

    // Create a limit for parallel workers (process 3 channels at a time)
    const limit = pLimit(3);

    // Start workers for all channels
    logger.info('Starting channel workers...');
    const startTime = Date.now();

    const workerPromises = channels.map(channel =>
      limit(() => runChannelWorker(channel, options.hours, options.days, options.test))
    );

    // Wait for all workers to complete
    const results = await Promise.allSettled(workerPromises);

    // Calculate execution time
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Generate summary report
    logger.info('\n' + '='.repeat(60));
    logger.info('EXECUTION SUMMARY');
    logger.info('='.repeat(60));

    let totalPosts = 0;
    let totalComments = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let successfulChannels = 0;
    let failedChannels = 0;

    results.forEach((result, index) => {
      const channel = channels[index];

      if (result.status === 'fulfilled' && result.value.success) {
        successfulChannels++;
        const stats = result.value.stats;
        totalPosts += stats.posts;
        totalComments += stats.comments;
        totalSuccessful += stats.successful;
        totalFailed += stats.failed;

        logger.info(`✓ ${channel.subreddit}: ${stats.posts} posts, ${stats.comments} comments (${stats.successful} successful, ${stats.failed} failed)`);

        // Log errors if any
        if (stats.errors && stats.errors.length > 0) {
          logger.warn(`  Errors encountered: ${stats.errors.length}`);
          stats.errors.slice(0, 3).forEach(err => {
            logger.warn(`    - ${err.id}: ${err.error}`);
          });
          if (stats.errors.length > 3) {
            logger.warn(`    ... and ${stats.errors.length - 3} more`);
          }
        }
      } else {
        failedChannels++;
        const error = result.status === 'fulfilled' ? result.value.error : result.reason.message;
        logger.error(`✗ ${channel.subreddit}: Failed - ${error}`);
      }
    });

    logger.info('='.repeat(60));
    logger.info(`Total: ${totalPosts} posts, ${totalComments} comments`);
    logger.info(`Ingestion: ${totalSuccessful} successful, ${totalFailed} failed`);
    logger.info(`Channels: ${successfulChannels} successful, ${failedChannels} failed`);
    logger.info(`Execution time: ${executionTime}s`);
    logger.info('='.repeat(60));

    // Exit with appropriate code
    if (failedChannels === channels.length) {
      logger.error('All channels failed');
      process.exit(1);
    } else if (failedChannels > 0) {
      logger.warn('Some channels failed');
      process.exit(0);
    } else {
      logger.info('All channels completed successfully');
      process.exit(0);
    }

  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info('\nReceived SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('\nReceived SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Run the main function
main();
