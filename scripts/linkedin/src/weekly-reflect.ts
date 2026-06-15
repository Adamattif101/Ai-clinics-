import { LinkedInClient } from './linkedin-client.js';
import { generateWeeklyPost } from './comment-ai.js';
import { readWeekLogs, logWeeklyReflection } from './logger.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

export async function runWeeklyReflection(): Promise<void> {
  console.log('Running weekly reflection...');

  const weekLogs = readWeekLogs();
  const posted = weekLogs.filter(l => l.status === 'comment_posted');

  if (posted.length === 0) {
    console.log('No engagements this week — skipping reflection post.');
    return;
  }

  const summary = posted
    .map(l => `Author: ${l.author_name}\nOur comment: ${l.comment_text}`)
    .join('\n---\n');

  console.log(`Analyzing ${posted.length} engagements from this week...`);
  const { themes, key_conversations, post_text } = await generateWeeklyPost(summary);

  const reflection = {
    date: new Date().toISOString().split('T')[0],
    themes_observed: themes,
    posts_engaged_count: posted.length,
    key_conversations,
    post_text,
  };

  logWeeklyReflection(reflection);

  console.log('\n=== WEEKLY REFLECTION ===');
  console.log('Themes observed:', themes);
  console.log('Key conversations:', key_conversations);
  console.log('\nDraft post:');
  console.log('-'.repeat(60));
  console.log(post_text);
  console.log('-'.repeat(60));

  if (DRY_RUN) {
    console.log('\nDRY RUN — post not published to LinkedIn.');
    return;
  }

  const client = new LinkedInClient();
  try {
    await client.init();
    await client.ensureLoggedIn();
    const success = await client.publishPost(post_text);
    if (success) {
      console.log('\nWeekly reflection post published to LinkedIn.');
    } else {
      console.warn('\nFailed to publish post. Draft saved to logs/');
    }
  } finally {
    await client.close();
  }
}
