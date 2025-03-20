// Website Change Monitor with Detailed Diff
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const diff = require('diff'); // You'll need to install this: npm install diff

// Configuration
const config = {
  // Websites to monitor [url, selector, name]
  websites: [
    // { url: 'https://www.reddit.com/r/popular/new/', selector: 'main', name: 'reddit' },
    { url: 'https://www.cs.cmu.edu/~15122/handouts.shtml', selector: 'main', name: '122' },
    // { url: 'https://another-site.com', selector: '.content', name: 'Another Site' }
  ],
  
  // Check interval in minutes
  checkInterval: 1,
  
  // Where to store the snapshots
  snapshotsDir: path.join(__dirname, 'snapshots'),
  
  // Discord notification settings
  discord: {
    enabled: true,
    webhookUrl: 'https://discord.com/api/webhooks/1350557398711931001/LJztzdH6eaLjmZLnrMF0Nvf61bf0rVStoLm_si65CShM2MP3j651l3QyRN5gDhiSr4Il',
    username: 'Website Monitor',
    avatarUrl: 'https://i.imgur.com/4M34hi2.png', // Optional
    maxDiffLines: 15 // Maximum number of diff lines to send in Discord
  }
};

// Make sure the snapshots directory existsx
if (!fs.existsSync(config.snapshotsDir)) {
  fs.mkdirSync(config.snapshotsDir, { recursive: true });
}

/**
 * Fetch website content
 * @param {string} url - Website URL
 * @param {string} selector - CSS selector to target specific content (optional)
 * @returns {Promise<string>} - HTML content
 */
async function fetchWebsite(url, selector) {
  try {
    const response = await axios.get(url);
    
    if (selector) {
      // Load HTML into cheerio and extract only the selected content
      const $ = cheerio.load(response.data);
      return $(selector).html() || '';
    } else {
      // Return the full HTML if no selector is provided
      return response.data;
    }
  } catch (error) {
    console.error(`Error fetching ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Clean HTML content for better diff results
 * @param {string} html - HTML content
 * @returns {string} - Cleaned text
 */
function cleanHtmlForDiff(html) {
  if (!html) return '';
  
  // Use cheerio to extract text and maintain some structure
  const $ = cheerio.load(html);
  
  // Remove script and style tags
  $('script, style').remove();
  
  // Replace consecutive whitespace with a single space
  let text = $.text().replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Calculate SHA-256 hash of content
 * @param {string} content - Content to hash
 * @returns {string} - Hash
 */
function calculateHash(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex');
}

/**
 * Save content snapshot
 * @param {string} siteName - Website name
 * @param {string} content - HTML content
 * @param {string} hash - Content hash
 */
function saveSnapshot(siteName, content, hash) {
  const siteDir = path.join(config.snapshotsDir, siteName.replace(/[^a-z0-9]/gi, '_').toLowerCase());
  
  if (!fs.existsSync(siteDir)) {
    fs.mkdirSync(siteDir, { recursive: true });
  }
  
  // Save content
  fs.writeFileSync(path.join(siteDir, 'latest.html'), content);
  
  // Save clean text for better diff
  fs.writeFileSync(path.join(siteDir, 'latest.txt'), cleanHtmlForDiff(content));
  
  // Save hash and timestamp
  fs.writeFileSync(path.join(siteDir, 'info.json'), JSON.stringify({
    hash: hash,
    lastChecked: new Date().toISOString(),
    lastChanged: new Date().toISOString()
  }));
}

/**
 * Update snapshot info
 * @param {string} siteName - Website name
 * @param {string} hash - Content hash
 * @param {boolean} changed - Whether content changed
 */
function updateSnapshotInfo(siteName, hash, changed) {
  const siteDir = path.join(config.snapshotsDir, siteName.replace(/[^a-z0-9]/gi, '_').toLowerCase());
  const infoPath = path.join(siteDir, 'info.json');
  
  if (fs.existsSync(infoPath)) {
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    info.hash = hash;
    info.lastChecked = new Date().toISOString();
    
    if (changed) {
      info.lastChanged = new Date().toISOString();
    }
    
    fs.writeFileSync(infoPath, JSON.stringify(info));
  }
}

/**
 * Generate a diff between old and new content
 * @param {string} oldContent - Previous content
 * @param {string} newContent - Current content
 * @returns {string} - Formatted diff summary
 */
function generateDiff(oldContent, newContent) {
  const changes = diff.diffWords(oldContent, newContent);
  let diffOutput = '';
  let addedCount = 0;
  let removedCount = 0;
  
  // Create a summary of changes
  changes.forEach(part => {
    if (part.added) {
      addedCount += part.value.split(/\s+/).filter(Boolean).length;
      // Only show a limited amount in the diff output
      if (diffOutput.split('\n').length < config.discord.maxDiffLines) {
        diffOutput += `\n+ ${part.value.substring(0, 200)}${part.value.length > 200 ? '...' : ''}`;
      }
    } else if (part.removed) {
      removedCount += part.value.split(/\s+/).filter(Boolean).length;
      // Only show a limited amount in the diff output
      if (diffOutput.split('\n').length < config.discord.maxDiffLines) {
        diffOutput += `\n- ${part.value.substring(0, 200)}${part.value.length > 200 ? '...' : ''}`;
      }
    }
  });
  
  // Create a summary
  let summary = `Changes detected: ${addedCount} words added, ${removedCount} words removed.`;
  
  // If diff is too long, add a note
  if (diffOutput.split('\n').length >= config.discord.maxDiffLines) {
    diffOutput += '\n... (more changes not shown)';
  }
  
  return summary + diffOutput;
}

/**
 * Send Discord notification with diff
 * @param {string} siteName - Website name
 * @param {string} url - Website URL
 * @param {string} diffText - Diff between old and new content
 */

async function sendDiscordNotification(siteName, url, diffText, addedCount, removedCount) {
  if (!config.discord.enabled || !config.discord.webhookUrl) {
    console.log('Discord notifications are disabled or webhook URL is missing');
    return false;
  }
  
  console.log('Preparing Discord notification with differences...');
  
  // Process the diff text to ensure it's valid
  if (!diffText || diffText.trim() === '') {
    diffText = 'Changes detected, but diff details unavailable.';
  }
  
  // Split the diff into lines
  const diffLines = diffText.split('\n').filter(line => line.trim() !== '');
  
  // Format the diff chunks for Discord - each chunk limited to 1000 chars for safety
  const CHUNK_SIZE = 1000;
  const diffChunks = [];
  
  let currentChunk = "";
  for (const line of diffLines) {
    // Skip summary line if it exists
    if (line.startsWith('Changes detected:')) continue;
    
    // If adding this line would exceed chunk size, start a new chunk
    if (currentChunk.length + line.length + 1 > CHUNK_SIZE) {
      diffChunks.push(currentChunk);
      currentChunk = "";
    }
    
    currentChunk += line + "\n";
  }
  
  // Add the last chunk if not empty
  if (currentChunk.trim() !== "") {
    diffChunks.push(currentChunk);
  }
  
  try {
    // Main notification with summary and first chunk of differences
    const mainPayload = {
      username: config.discord.username || 'Website Monitor',
      avatar_url: config.discord.avatarUrl,
      embeds: [{
        title: `🔍 Change Detected: ${siteName}`,
        description: `Website changes detected at ${new Date().toLocaleString()}`,
        url: url,
        color: 15844367, // Gold color in decimal
        fields: [
          {
            name: 'Summary',
            value: `📊 ${addedCount || 0} words added, ${removedCount || 0} words removed`,
            inline: false
          },
          {
            name: 'Changes Part 1',
            value: diffChunks.length > 0 
              ? `\`\`\`diff\n${diffChunks[0]}\n\`\`\``
              : "No detailed diff available",
            inline: false
          }
        ],
        footer: {
          text: `Website Monitor • ${diffChunks.length > 1 ? 'Additional parts follow' : 'Complete diff shown'}`
        }
      }]
    };
    
    console.log('Sending main notification...');
    await axios.post(config.discord.webhookUrl, mainPayload);
    
    // If there are more diff chunks, send them as follow-up messages
    for (let i = 1; i < diffChunks.length; i++) {
      const followUpPayload = {
        username: config.discord.username || 'Website Monitor',
        avatar_url: config.discord.avatarUrl,
        embeds: [{
          title: `Changes Part ${i+1}/${diffChunks.length}`,
          description: `\`\`\`diff\n${diffChunks[i]}\n\`\`\``,
          color: 15844367, // Gold color in decimal
          footer: {
            text: `${siteName} • ${new Date().toLocaleString()}`
          }
        }]
      };
      
      console.log(`Sending follow-up notification part ${i+1}...`);
      // Add small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      await axios.post(config.discord.webhookUrl, followUpPayload);
    }
    
    console.log(`Discord notification(s) sent successfully for ${siteName}`);
    return true;
  } catch (error) {
    console.error(`Error sending Discord notification: ${error.message}`);
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      if (error.response.data) {
        console.error(`Error details: ${JSON.stringify(error.response.data)}`);
      }
      
      // Even if the formatted version fails, try to send a basic text-only version
      try {
        console.log('Attempting to send simplified notification...');
        const fallbackPayload = {
          username: config.discord.username || 'Website Monitor',
          content: `🔍 Change detected on ${siteName} at ${new Date().toLocaleString()}\n\n` +
                   `Summary: ${addedCount || 0} words added, ${removedCount || 0} words removed\n\n` +
                   `The changes were too complex to display in Discord format. Check the console output for details.`
        };
        
        await axios.post(config.discord.webhookUrl, fallbackPayload);
        console.log('Simplified notification sent successfully');
        return true;
      } catch (fallbackError) {
        console.error(`Even simplified notification failed: ${fallbackError.message}`);
      }
    }
    
    return false;
  }
}

/**
 * Check a website for changes
 * @param {object} website - Website configuration
 */
async function checkWebsite(website) {
  console.log(`Checking ${website.name} (${website.url})...`);
  
  const content = await fetchWebsite(website.url, website.selector);
  if (!content) return;
  
  const currentHash = calculateHash(content);
  const siteName = website.name;
  const siteDir = path.join(config.snapshotsDir, siteName.replace(/[^a-z0-9]/gi, '_').toLowerCase());
  const infoPath = path.join(siteDir, 'info.json');
  
  // Check if we have a previous snapshot
  if (!fs.existsSync(siteDir) || !fs.existsSync(infoPath)) {
    console.log(`First snapshot for ${siteName}`);
    saveSnapshot(siteName, content, currentHash);
    return;
  }
  
  // Compare with previous snapshot
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  const previousHash = info.hash;
  
  if (currentHash !== previousHash) {
    console.log(`\n==================================================`);
    console.log(`🔔 CHANGES DETECTED on ${siteName}!`);
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log(`URL: ${website.url}`);
    console.log(`==================================================`);
    
    // Get the old content for diff
    const oldContentPath = path.join(siteDir, 'latest.txt');
    let oldContent = '';
    if (fs.existsSync(oldContentPath)) {
      oldContent = fs.readFileSync(oldContentPath, 'utf8');
    }
    
    // Generate clean text of new content for diff
    const newContent = cleanHtmlForDiff(content);
    
    // Generate diff between old and new content
    const changes = diff.diffWords(oldContent, newContent);
    let addedCount = 0;
    let removedCount = 0;
    
    // Log detailed changes to console
    console.log(`\nDETAILED CHANGES:`);
    console.log(`--------------------------------------------------`);
    
    changes.forEach(part => {
      if (part.added) {
        addedCount += part.value.split(/\s+/).filter(Boolean).length;
        // Show added content in green if terminal supports it
        console.log(`+ ADDED: ${part.value.substring(0, 500)}${part.value.length > 500 ? '...' : ''}`);
      } else if (part.removed) {
        removedCount += part.value.split(/\s+/).filter(Boolean).length;
        // Show removed content in red if terminal supports it
        console.log(`- REMOVED: ${part.value.substring(0, 500)}${part.value.length > 500 ? '...' : ''}`);
      }
    });
    
    console.log(`--------------------------------------------------`);
    console.log(`SUMMARY: ${addedCount} words added, ${removedCount} words removed.`);
    console.log(`==================================================\n`);
    
    // Archive previous snapshot
    const latestPath = path.join(siteDir, 'latest.html');
    if (fs.existsSync(latestPath)) {
      const archivePath = path.join(siteDir, `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
      fs.copyFileSync(latestPath, archivePath);
    }
    
    // Save new snapshot
    saveSnapshot(siteName, content, currentHash);
    
    // Update info
    updateSnapshotInfo(siteName, currentHash, true);
    
    // Create diffText for Discord notification
    const diffText = changes.map(part => {
      if (part.added) return `+ ${part.value.substring(0, 200)}${part.value.length > 200 ? '...' : ''}`;
      if (part.removed) return `- ${part.value.substring(0, 200)}${part.value.length > 200 ? '...' : ''}`;
      return '';
    }).filter(Boolean).join('\n');
    
    // Send notification with diff
    try {
      await sendDiscordNotification(siteName, website.url, 
        `Changes detected: ${addedCount} words added, ${removedCount} words removed.\n${diffText}`);
      console.log(`Discord notification sent for ${siteName}`);
    } catch (error) {
      console.error(`Error sending Discord notification: ${error.message}`);
      if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error(`Data: ${JSON.stringify(error.response.data)}`);
      }
    }
  } else {
    console.log(`No changes on ${siteName}`);
    updateSnapshotInfo(siteName, currentHash, false);
  }
}

/**
 * Run a monitoring cycle for all websites
 */
async function monitorWebsites() {
  console.log(`=== Starting monitoring cycle at ${new Date().toLocaleString()} ===`);
  
  for (const website of config.websites) {
    await checkWebsite(website);
  }
  
  console.log('=== Monitoring cycle completed ===\n');
}

// Run immediately on start
monitorWebsites();

// Then schedule regular checks
setInterval(monitorWebsites, config.checkInterval * 60 * 1000);

// Test Discord notification - remove after testing
// (async function() {
//   console.log("Sending test Discord notification...");
//   try {
//     await sendDiscordNotification(
//       "Test Website", 
//       "https://example.com", 
//       "This is a test notification"
//     );
//     console.log("Test notification sent successfully!");
//   } catch (error) {
//     console.error("Error sending test notification:", error);
//   }
// })();

console.log(`Website monitor started. Checking ${config.websites.length} websites every ${config.checkInterval} minutes.`);