#!/usr/bin/env node

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { loadChannelsConfig, getEnabledChannels } from '../config/loader.js';
import { JobManager } from './jobManager.js';
import { createLogger } from '../utils/logger.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('WebServer');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const jobManager = new JobManager();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// API Routes

/**
 * GET /api/config
 * Get channel configuration
 */
app.get('/api/config', (req, res) => {
  try {
    const config = loadChannelsConfig();
    const allChannels = Object.keys(config).map(subreddit => ({
      subreddit,
      enabled: config[subreddit].enabled
    }));
    res.json({ channels: allChannels });
  } catch (error) {
    logger.error(`Failed to load config: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/channels
 * Add a new channel
 */
app.post('/api/channels', async (req, res) => {
  try {
    const { subreddit, enabled } = req.body;

    // Validate input
    if (!subreddit) {
      return res.status(400).json({ error: 'Missing required field: subreddit' });
    }

    // Normalize subreddit name (ensure it starts with r/)
    const normalizedSubreddit = subreddit.startsWith('r/') ? subreddit : `r/${subreddit}`;

    // Load current config
    const config = loadChannelsConfig();

    // Check if channel already exists
    if (config[normalizedSubreddit]) {
      return res.status(400).json({ error: 'Channel already exists' });
    }

    // Add channel
    config[normalizedSubreddit] = {
      enabled: enabled !== false // Default to true
    };

    // Save config
    const fs = await import('fs');
    const configPath = path.join(__dirname, '../../config/channels.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    logger.info(`Channel ${normalizedSubreddit} added`);

    res.json({
      success: true,
      message: `Channel ${normalizedSubreddit} added successfully`,
      channel: {
        subreddit: normalizedSubreddit,
        enabled: config[normalizedSubreddit].enabled
      }
    });

  } catch (error) {
    logger.error(`Failed to add channel: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/channels/:subreddit
 * Toggle channel enabled status
 */
app.put('/api/channels/:subreddit', async (req, res) => {
  try {
    const subreddit = req.params.subreddit;
    const { enabled } = req.body;

    // Load current config
    const config = loadChannelsConfig();

    if (!config[subreddit]) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Update enabled status
    if (enabled !== undefined) {
      config[subreddit].enabled = enabled;
    }

    // Save config
    const fs = await import('fs');
    const configPath = path.join(__dirname, '../../config/channels.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    logger.info(`Channel ${subreddit} updated`);

    res.json({
      success: true,
      message: `Channel ${subreddit} updated successfully`,
      channel: {
        subreddit,
        enabled: config[subreddit].enabled
      }
    });

  } catch (error) {
    logger.error(`Failed to update channel: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/channels/:subreddit
 * Delete a channel
 */
app.delete('/api/channels/:subreddit', async (req, res) => {
  try {
    const subreddit = req.params.subreddit;

    // Load current config
    const config = loadChannelsConfig();

    if (!config[subreddit]) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Delete channel
    delete config[subreddit];

    // Save config
    const fs = await import('fs');
    const configPath = path.join(__dirname, '../../config/channels.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    logger.info(`Channel ${subreddit} deleted`);

    res.json({
      success: true,
      message: `Channel ${subreddit} deleted successfully`
    });

  } catch (error) {
    logger.error(`Failed to delete channel: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/jobs
 * Get all jobs
 */
app.get('/api/jobs', (req, res) => {
  const jobs = jobManager.getAllJobs();
  res.json({ jobs });
});

/**
 * GET /api/jobs/active
 * Get active jobs (running or pending)
 */
app.get('/api/jobs/active', (req, res) => {
  const jobs = jobManager.getActiveJobs();
  res.json({ jobs });
});

/**
 * GET /api/jobs/:id
 * Get a specific job
 */
app.get('/api/jobs/:id', (req, res) => {
  const jobId = parseInt(req.params.id);
  const job = jobManager.getJobSummary(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({ job });
});

/**
 * POST /api/jobs
 * Create and start a new job
 */
app.post('/api/jobs', async (req, res) => {
  try {
    const { hours, days, testMode } = req.body;

    // Validate parameters
    if (!hours && !days) {
      return res.status(400).json({ error: 'Must specify either hours or days' });
    }

    if (hours && days) {
      return res.status(400).json({ error: 'Cannot specify both hours and days' });
    }

    if (hours && hours <= 0) {
      return res.status(400).json({ error: 'hours must be a positive number' });
    }

    if (days && days <= 0) {
      return res.status(400).json({ error: 'days must be a positive number' });
    }

    // Check for API token
    if (!process.env.VECTORDB_API_TOKEN) {
      return res.status(500).json({ error: 'VECTORDB_API_TOKEN environment variable is not set' });
    }

    // Load configuration
    const config = loadChannelsConfig();
    const channels = getEnabledChannels(config);

    if (channels.length === 0) {
      return res.status(400).json({ error: 'No enabled channels found in configuration' });
    }

    // Create job
    const jobId = jobManager.createJob(channels, hours, days, testMode || false);

    // Start job asynchronously (don't wait for it to complete)
    jobManager.startJob(jobId, channels).catch(error => {
      logger.error(`Job ${jobId} failed: ${error.message}`);
    });

    res.json({
      success: true,
      jobId,
      message: `Job ${jobId} started with ${channels.length} channels`
    });

  } catch (error) {
    logger.error(`Failed to create job: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/jobs/:id
 * Delete a job
 */
app.delete('/api/jobs/:id', (req, res) => {
  try {
    const jobId = parseInt(req.params.id);

    const deleted = jobManager.deleteJob(jobId);

    if (!deleted) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ success: true, message: `Job ${jobId} deleted` });

  } catch (error) {
    logger.error(`Failed to delete job: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    activeJobs: jobManager.getActiveJobs().length,
    totalJobs: jobManager.getAllJobs().length
  });
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  logger.info('WebSocket client connected');

  // Send current state to new client
  ws.send(JSON.stringify({
    type: 'initial_state',
    jobs: jobManager.getAllJobs()
  }));

  // Subscribe to job updates
  const unsubscribe = jobManager.subscribe((event) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(event));
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket client disconnected');
    unsubscribe();
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket error: ${error.message}`);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  logger.info(`Reddit Intelligence Daemon Web UI started`);
  logger.info(`Server running at http://localhost:${PORT}`);
  logger.info(`WebSocket server ready for real-time updates`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logger.info('Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
