import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load and parse the channels configuration file
 * @param {string} configPath - Path to the channels.json file
 * @returns {Object} Parsed configuration object
 */
export function loadChannelsConfig(configPath = null) {
  const defaultPath = path.join(__dirname, '../../config/channels.json');
  const filePath = configPath || defaultPath;

  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(fileContent);

    // Validate configuration structure
    if (typeof config !== 'object' || config === null) {
      throw new Error('Configuration must be a valid object');
    }

    return config;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Configuration file not found at: ${filePath}`);
    }
    throw new Error(`Failed to load configuration: ${error.message}`);
  }
}

/**
 * Get only enabled channels from the configuration
 * @param {Object} config - Full configuration object
 * @returns {Array} Array of enabled channel objects with subreddit name
 */
export function getEnabledChannels(config) {
  const channels = [];

  // Get shared credentials from environment variables
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('Warning: REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET not set in environment variables');
    return channels;
  }

  for (const [subreddit, channelConfig] of Object.entries(config)) {
    if (channelConfig.enabled === true) {
      channels.push({
        subreddit,
        platform: channelConfig.platform || subreddit,
        clientId,
        clientSecret
      });
    }
  }

  return channels;
}

/**
 * Validate channel configuration
 * @param {Object} channelConfig - Channel configuration to validate
 * @returns {boolean} True if valid, throws error otherwise
 */
export function validateChannelConfig(channelConfig) {
  const requiredFields = ['clientId', 'clientSecret'];

  for (const field of requiredFields) {
    if (!channelConfig[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return true;
}
