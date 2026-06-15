/**
 * LinkedIn Automation for AI Therapy & Wellness Space
 *
 * Commands:
 *   engage          - Daily engagement: discover posts, generate & post comments (10 AM)
 *   engage --dry-run - Discover posts and draft comments without posting
 *   reflect         - Weekly reflection: analyze week's themes, publish insight post (Sunday 5 PM)
 *   reflect --dry-run - Generate draft reflection without publishing
 *   setup           - Verify LinkedIn login and save session
 */

import 'dotenv/config';

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (dryRun) process.env.DRY_RUN = 'true';

async function main() {
  switch (command) {
    case 'engage': {
      const { runDailyEngagement } = await import('./daily-engage.js');
      await runDailyEngagement();
      break;
    }
    case 'reflect': {
      const { runWeeklyReflection } = await import('./weekly-reflect.js');
      await runWeeklyReflection();
      break;
    }
    case 'setup': {
      const { LinkedInClient } = await import('./linkedin-client.js');
      const client = new LinkedInClient();
      await client.init();
      await client.ensureLoggedIn();
      console.log('LinkedIn session established and saved.');
      await client.close();
      break;
    }
    default:
      console.log(`
LinkedIn Automation — AI Therapy & Wellness Space

Usage:
  npm run engage          # Daily: find posts + comment + like + follow
  npm run engage:dry      # Dry run: draft comments only, no posting
  npm run reflect         # Sunday: weekly analysis + publish insight post
  npm run setup           # One-time: verify login and save session

Environment variables (copy .env.example → .env):
  LINKEDIN_EMAIL          LinkedIn login email
  LINKEDIN_PASSWORD       LinkedIn login password
  LINKEDIN_NAME           Your display name (to detect already-commented posts)
  ANTHROPIC_API_KEY       Claude API key for comment generation
  COMMENT_DELAY_MS        Milliseconds between comments (default: 7200000 = 2 hours)
  MAX_COMMENTS_PER_DAY    Max comments per run (default: 6)
  DRY_RUN                 Set to "true" to draft without posting
      `);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
