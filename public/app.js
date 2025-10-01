// WebSocket connection
let ws = null;
let reconnectTimer = null;

// DOM elements
const wsStatus = document.getElementById('ws-status');
const activeJobsCount = document.getElementById('active-jobs-count');
const totalJobsCount = document.getElementById('total-jobs-count');
const activeJobsContainer = document.getElementById('active-jobs');
const jobHistoryContainer = document.getElementById('job-history');
const channelsList = document.getElementById('channels-list');
const newJobForm = document.getElementById('new-job-form');
const hoursInput = document.getElementById('hours-input');
const daysInput = document.getElementById('days-input');
const testModeCheckbox = document.getElementById('test-mode');

// State
let jobs = [];
let channels = [];

// Initialize WebSocket connection
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    wsStatus.textContent = 'Connected';
    wsStatus.className = 'badge badge-success';
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    wsStatus.textContent = 'Disconnected';
    wsStatus.className = 'badge badge-danger';

    // Attempt to reconnect after 3 seconds
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    wsStatus.textContent = 'Error';
    wsStatus.className = 'badge badge-danger';
  };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
  console.log('Received:', data);

  switch (data.type) {
    case 'initial_state':
      jobs = data.jobs;
      renderJobs();
      break;

    case 'job_created':
    case 'job_started':
    case 'job_completed':
      updateOrAddJob(data.job);
      break;

    case 'channel_progress':
    case 'channel_completed':
    case 'channel_error':
      updateChannelStatus(data);
      break;

    case 'job_deleted':
      removeJob(data.jobId);
      break;
  }

  updateCounts();
}

// Update or add a job to the list
function updateOrAddJob(job) {
  const index = jobs.findIndex(j => j.id === job.id);
  if (index >= 0) {
    jobs[index] = job;
  } else {
    jobs.unshift(job);
  }
  renderJobs();
}

// Update channel status within a job
function updateChannelStatus(data) {
  const job = jobs.find(j => j.id === data.jobId);
  if (!job) return;

  const channel = job.channels.find(ch => ch.subreddit === data.subreddit);
  if (!channel) return;

  if (data.type === 'channel_progress') {
    channel.status = data.status;
    if (data.postsCount) {
      channel.postsCount = data.postsCount;
    }
  } else if (data.type === 'channel_completed') {
    channel.status = 'completed';
    channel.stats = data.stats;
  } else if (data.type === 'channel_error') {
    channel.status = 'failed';
    channel.error = data.error;
  }

  renderJobs();
}

// Remove a job from the list
function removeJob(jobId) {
  jobs = jobs.filter(j => j.id !== jobId);
  renderJobs();
}

// Update job counts
function updateCounts() {
  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending');
  activeJobsCount.textContent = activeJobs.length;
  totalJobsCount.textContent = jobs.length;
}

// Render all jobs
function renderJobs() {
  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending');
  const completedJobs = jobs.filter(j => j.status === 'completed');

  // Render active jobs
  if (activeJobs.length === 0) {
    activeJobsContainer.innerHTML = '<p class="empty-state">No active jobs</p>';
  } else {
    activeJobsContainer.innerHTML = activeJobs.map(job => renderJob(job)).join('');
  }

  // Render job history
  if (completedJobs.length === 0) {
    jobHistoryContainer.innerHTML = '<p class="empty-state">No completed jobs</p>';
  } else {
    jobHistoryContainer.innerHTML = completedJobs.slice(0, 10).map(job => renderJob(job)).join('');
  }
}

// Render a single job
function renderJob(job) {
  const statusClass = job.status === 'running' ? 'running' : job.status === 'completed' ? 'completed' : 'failed';
  const timeWindow = job.params.hours ? `${job.params.hours} hours` : `${job.params.days} days`;
  const testModeLabel = job.params.testMode ? ' <span class="badge badge-warning">TEST</span>' : '';

  const completedChannels = job.channels.filter(ch => ch.status === 'completed').length;
  const totalChannels = job.channels.length;
  const progress = (completedChannels / totalChannels) * 100;

  return `
    <div class="job-item ${statusClass}">
      <div class="job-header">
        <div class="job-title">
          Job #${job.id} ${testModeLabel}
        </div>
        <div>
          <span class="badge badge-${getStatusBadgeClass(job.status)}">${job.status.toUpperCase()}</span>
          ${job.status === 'completed' ? `<button class="btn btn-danger" onclick="deleteJob(${job.id})">Delete</button>` : ''}
        </div>
      </div>

      <div class="job-meta">
        <span>⏱️ ${timeWindow}</span>
        <span>📡 ${totalChannels} channels</span>
        <span>🕒 Started: ${formatTime(job.startedAt || job.createdAt)}</span>
        ${job.completedAt ? `<span>✅ Completed: ${formatTime(job.completedAt)}</span>` : ''}
      </div>

      ${job.status === 'completed' ? `
        <div class="job-stats">
          <div class="stat-item">
            <span class="stat-label">Posts:</span>
            <span>${job.totalStats.posts}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Comments:</span>
            <span>${job.totalStats.comments}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Ingested:</span>
            <span>${job.totalStats.successful}</span>
          </div>
          ${job.totalStats.failed > 0 ? `
            <div class="stat-item">
              <span class="stat-label">Failed:</span>
              <span>${job.totalStats.failed}</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${job.status === 'running' ? `
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
      ` : ''}

      <div class="channels-list">
        ${job.channels.map(ch => renderChannel(ch)).join('')}
      </div>
    </div>
  `;
}

// Render a single channel
function renderChannel(channel) {
  let statusContent = '';

  if (channel.status === 'pending') {
    statusContent = '<span class="badge badge-secondary">Pending</span>';
  } else if (channel.status === 'started' || channel.status === 'fetching') {
    statusContent = `<span class="spinner"></span><span class="badge badge-info">${channel.status}</span>`;
  } else if (channel.status === 'ingesting') {
    statusContent = `<span class="spinner"></span><span class="badge badge-info">Ingesting ${channel.postsCount || ''} posts</span>`;
  } else if (channel.status === 'completed' && channel.stats) {
    statusContent = `<span class="badge badge-success">✓ ${channel.stats.posts}p / ${channel.stats.comments}c</span>`;
  } else if (channel.status === 'failed') {
    statusContent = `<span class="badge badge-danger">✗ Failed</span>`;
  }

  return `
    <div class="channel-item">
      <div class="channel-name">${channel.subreddit}</div>
      <div class="channel-status">${statusContent}</div>
    </div>
  `;
}

// Get status badge class
function getStatusBadgeClass(status) {
  switch (status) {
    case 'pending':
      return 'secondary';
    case 'running':
      return 'info';
    case 'completed':
      return 'success';
    default:
      return 'danger';
  }
}

// Format timestamp
function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// Delete a job
async function deleteJob(jobId) {
  if (!confirm(`Are you sure you want to delete Job #${jobId}?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/jobs/${jobId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete job');
    }

    console.log(`Job ${jobId} deleted`);
  } catch (error) {
    console.error('Failed to delete job:', error);
    alert(`Failed to delete job: ${error.message}`);
  }
}

// Handle form submission
newJobForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const timeUnit = document.querySelector('input[name="time-unit"]:checked').value;
  const hours = timeUnit === 'hours' ? parseInt(hoursInput.value) : null;
  const days = timeUnit === 'days' ? parseInt(daysInput.value) : null;
  const testMode = testModeCheckbox.checked;

  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ hours, days, testMode })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start job');
    }

    console.log('Job started:', data);
    // Form will be reset and UI will update via WebSocket
    newJobForm.reset();

  } catch (error) {
    console.error('Failed to start job:', error);
    alert(`Failed to start job: ${error.message}`);
  }
});

// Handle time unit radio buttons
document.querySelectorAll('input[name="time-unit"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'hours') {
      hoursInput.disabled = false;
      daysInput.disabled = true;
    } else {
      hoursInput.disabled = true;
      daysInput.disabled = false;
    }
  });
});

// Load channels configuration
async function loadChannels() {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    channels = data.channels || [];
    renderChannels();
  } catch (error) {
    console.error('Failed to load channels:', error);
    channelsList.innerHTML = '<p class="empty-state">Failed to load channels</p>';
  }
}

// Render channels list
function renderChannels() {
  if (channels.length === 0) {
    channelsList.innerHTML = '<p class="empty-state">No channels configured</p>';
    return;
  }

  channelsList.innerHTML = channels.map(ch => `
    <div class="channel-list-item">
      <div class="channel-icon">📡</div>
      <div class="channel-info">
        <div class="channel-info-name">${ch.subreddit}</div>
        <div class="channel-info-footer">
          <span class="badge badge-${ch.enabled ? 'success' : 'secondary'}">${ch.enabled ? 'Enabled' : 'Disabled'}</span>
          <div class="channel-actions">
            <button class="btn-icon" onclick="toggleChannel('${ch.subreddit}', ${!ch.enabled})" title="${ch.enabled ? 'Disable' : 'Enable'}">
              ${ch.enabled ? '⏸️' : '▶️'}
            </button>
            <button class="btn-icon delete" onclick="deleteChannel('${ch.subreddit}')" title="Delete">🗑️</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// Modal functions
function showAddChannelModal() {
  document.getElementById('modal-subreddit').value = '';
  document.getElementById('modal-enabled').checked = true;
  document.getElementById('channel-modal').classList.add('active');
}

function closeChannelModal() {
  document.getElementById('channel-modal').classList.remove('active');
}

// Handle channel form submission
document.getElementById('channel-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const subreddit = document.getElementById('modal-subreddit').value.trim();
  const enabled = document.getElementById('modal-enabled').checked;

  try {
    const response = await fetch('/api/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ subreddit, enabled })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to add channel');
    }

    console.log('Channel added:', data);
    closeChannelModal();
    loadChannels(); // Reload channels list

  } catch (error) {
    console.error('Failed to add channel:', error);
    alert(`Failed to add channel: ${error.message}`);
  }
});

// Toggle channel enabled/disabled
async function toggleChannel(subreddit, enabled) {
  try {
    const response = await fetch(`/api/channels/${encodeURIComponent(subreddit)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ enabled })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update channel');
    }

    console.log('Channel updated:', data);
    loadChannels(); // Reload channels list

  } catch (error) {
    console.error('Failed to update channel:', error);
    alert(`Failed to update channel: ${error.message}`);
  }
}

// Delete channel
async function deleteChannel(subreddit) {
  if (!confirm(`Are you sure you want to delete ${subreddit}?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/channels/${encodeURIComponent(subreddit)}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete channel');
    }

    console.log('Channel deleted:', data);
    loadChannels(); // Reload channels list

  } catch (error) {
    console.error('Failed to delete channel:', error);
    alert(`Failed to delete channel: ${error.message}`);
  }
}

// Close modal when clicking outside
document.getElementById('channel-modal').addEventListener('click', (e) => {
  if (e.target.id === 'channel-modal') {
    closeChannelModal();
  }
});

// Initialize
connectWebSocket();
loadChannels();
updateCounts();
