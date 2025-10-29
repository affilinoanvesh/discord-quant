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
  console.log(`📊 Monitoring Guild ID: ${DISCORD_GUILD_ID}`);
  console.log(`🌐 API URL: ${API_URL}`);
  console.log(`🔐 Webhook Secret: ${DISCORD_WEBHOOK_SECRET ? 'SET' : 'NOT SET'}`);
  
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
    
    console.log(`✅ Found guild: ${guild.name}`);
    
    const guildInvites = await guild.invites.fetch();
    guildInvites.forEach(invite => {
      invites.set(invite.code, invite.uses || 0);
      console.log(`   📌 ${invite.code}: ${invite.uses || 0} uses (max: ${invite.maxUses || '∞'})`);
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
  console.log(`\n👤 New member joined: ${member.user.tag} (${member.id})`);
  
  try {
    const guild = member.guild;
    
    // Fetch current invites
    const newInvites = await guild.invites.fetch();
    
    // Find which invite was used
    let usedInvite = null;
    for (const [code, invite] of newInvites) {
      const oldUses = invites.get(code) || 0;
      const currentUses = invite.uses || 0;
      
      if (currentUses > oldUses) {
        usedInvite = invite;
        invites.set(code, currentUses);
        break;
      }
    }
    
    // Update cache with all invites
    newInvites.forEach(invite => {
      invites.set(invite.code, invite.uses || 0);
    });
    
    const inviteCode = usedInvite ? usedInvite.code : null;
    
    if (!usedInvite) {
      console.log('⚠️  Could not determine which invite was used');
      console.log('   This can happen with vanity URLs or if bot wasn\'t caching invites');
      console.log('   Will still notify API but without invite code');
    } else {
      console.log(`🎫 Used invite code: ${inviteCode}`);
      console.log(`   Created by: ${usedInvite.inviter?.tag || 'Unknown'}`);
    }
    
    // Call the webhook to assign roles (even without invite code)
    console.log(`📡 Calling API to assign roles...`);
    console.log(`   URL: ${API_URL}/api/discord/webhook`);
    
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
        console.log(`✅ Roles assigned successfully!`);
      } else {
        console.error(`❌ Failed to assign roles: ${data.error}`);
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
  console.log(`\n👋 Member left: ${member.user.tag} (${member.id})`);
  
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

