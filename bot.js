/**
 * Discord Bot for Trading Signals Platform
 * 
 * This bot:
 * - Listens for new members joining via invite links
 * - Automatically assigns roles based on their subscription
 * - Tracks invite usage
 * - Notifies the main API when members join/leave
 */

import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import express from 'express';
import 'dotenv/config';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_WEBHOOK_SECRET = process.env.DISCORD_WEBHOOK_SECRET;
const API_URL = process.env.API_URL || process.env.WEBHOOK_URL || 'https://your-domain.com';

// Create Discord client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

// Cache invites to track which one was used
const invites = new Map();

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  
  // Cache all existing invites
  try {
    const guild = client.guilds.cache.get(DISCORD_GUILD_ID);
    if (!guild) {
      console.error(`❌ GUILD NOT FOUND! Bot is not in guild ${DISCORD_GUILD_ID}`);
      console.error(`   Bot is in these guilds:`);
      client.guilds.cache.forEach(g => {
        console.error(`   - ${g.name} (${g.id})`);
      });
      return;
    }
    
    const guildInvites = await guild.invites.fetch();
    guildInvites.forEach(invite => {
      invites.set(invite.code, invite.uses || 0);
    });
    console.log(`🔗 Cached ${guildInvites.size} invites`);
  } catch (error) {
    console.warn('⚠️  Cannot fetch invites - bot needs "Manage Server" permission');
    console.warn('   Bot will still work but cannot track which invite was used');
    console.warn('   To fix: Server Settings → Roles → Bot Role → Enable "Manage Server"');
    console.error('   Error details:', error.message);
  }
  
  console.log('🚀 Bot is ready and listening for events!');
});

// Handle new member joins
client.on('guildMemberAdd', async (member) => {
  console.log(`👤 New member joined: ${member.user.tag}`);
  
  try {
    const guild = member.guild;
    const newInvites = await guild.invites.fetch();
    
    // Find which invite was used
    let usedInvite = null;
    
    // First check for new invites not in cache
    for (const [code, invite] of newInvites) {
      if (!invites.has(code)) {
        invites.set(code, invite.uses || 0);
        usedInvite = invite;
        break;
      }
    }
    
    // If no new invite, check for usage increase on existing invites
    if (!usedInvite) {
      for (const [code, invite] of newInvites) {
        const oldUses = invites.get(code) || 0;
        const currentUses = invite.uses || 0;
        
        if (currentUses > oldUses) {
          usedInvite = invite;
          invites.set(code, currentUses);
          break;
        }
      }
    }
    
    // Update cache with all invites
    newInvites.forEach(invite => {
      invites.set(invite.code, invite.uses || 0);
    });
    
    const inviteCode = usedInvite ? usedInvite.code : null;
    
    if (!usedInvite) {
      console.log('⚠️  Could not determine which invite was used');
    }
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(`${API_URL}/api/discord/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Discord-Signature': DISCORD_WEBHOOK_SECRET,
        },
        body: JSON.stringify({
          event: 'member_join',
          user_id: member.id,
          username: member.user.tag,
          invite_code: inviteCode,
          guild_id: guild.id,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ API error (${response.status}): ${errorText}`);
        return;
      }
    
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Roles assigned successfully`);
      } else {
        console.error(`❌ Failed to assign roles`);
      }
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        console.error('❌ API request timed out after 10 seconds');
      } else {
        console.error(`❌ Failed to call webhook: ${fetchError.message}`);
      }
    }
  } catch (error) {
    console.error('❌ Error handling member join:', error.message);
  }
});

// Handle member leaves
client.on('guildMemberRemove', async (member) => {
  console.log(`👋 Member left: ${member.user.tag}`);
  
  try {
    // Notify API that user left
    const response = await fetch(`${API_URL}/api/discord/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Discord-Signature': DISCORD_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        event: 'member_leave',
        user_id: member.id,
        username: member.user.tag,
        guild_id: member.guild.id,
      }),
    });
    
    if (response.ok) {
      console.log(`✅ Database updated`);
    } else {
      console.error(`❌ Failed to update database`);
    }
  } catch (error) {
    console.error('❌ Error handling member leave:', error.message);
  }
});

// Handle invite creation (to keep cache updated)
client.on('inviteCreate', async (invite) => {
  invites.set(invite.code, invite.uses || 0);
  console.log(`🔗 New invite created: ${invite.code}`);
});

// Handle invite deletion (to keep cache updated)
client.on('inviteDelete', async (invite) => {
  invites.delete(invite.code);
  console.log(`🗑️  Invite deleted: ${invite.code}`);
});

// Function to refresh invite cache
async function refreshInviteCache() {
  try {
    const guild = client.guilds.cache.get(DISCORD_GUILD_ID);
    if (guild) {
      const guildInvites = await guild.invites.fetch();
      guildInvites.forEach(invite => {
        invites.set(invite.code, invite.uses || 0);
      });
      return { success: true };
    }
  } catch (error) {
    console.error('Error refreshing invite cache:', error.message);
    return { success: false, error: error.message };
  }
}

// Periodically refresh invite cache (every 5 minutes as backup)
// Instant refresh happens via HTTP endpoint when dashboard creates invite
setInterval(refreshInviteCache, 300000);

// HTTP server to trigger cache refresh
const app = express();
app.use(express.json());

app.post('/refresh-cache', (req, res) => {
  const secret = req.headers['x-refresh-secret'];
  if (secret !== DISCORD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  console.log('Refreshing invite cache');
  refreshInviteCache().then(result => {
    res.json(result);
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', cachedInvites: invites.size });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`📡 Bot HTTP server listening on port ${PORT}`);
});

// Error handling
client.on('error', (error) => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

// Login
if (!DISCORD_BOT_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN not found in environment variables!');
  console.error('   Please create a .env file with your bot token');
  process.exit(1);
}

if (!DISCORD_GUILD_ID) {
  console.error('❌ DISCORD_GUILD_ID not found in environment variables!');
  process.exit(1);
}

if (!DISCORD_WEBHOOK_SECRET) {
  console.warn('⚠️  DISCORD_WEBHOOK_SECRET not set - webhook calls may fail');
}

console.log('🚀 Starting bot...');
client.login(DISCORD_BOT_TOKEN)
  .catch(error => {
    console.error('❌ Failed to login:', error);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down bot...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down bot...');
  client.destroy();
  process.exit(0);
});

