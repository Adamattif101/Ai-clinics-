import { LinkedInClient } from './linkedin-client.js';
import { generateComment } from './comment-ai.js';
import { logEngagement, getPostedUrls } from './logger.js';
import type { DiscoveredPost } from './types.js';

const MAX_PER_DAY = parseInt(process.env.MAX_COMMENTS_PER_DAY ?? '6');
const DELAY_MS = parseInt(process.env.COMMENT_DELAY_MS ?? '7200000');
const DRY_RUN = process.env.DRY_RUN === 'true';
const MY_NAME = process.env.LINKEDIN_NAME ?? '';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function runDailyEngagement(): Promise<void> {
  if (DRY_RUN) console.log('🔍 DRY RUN — posts will be discovered and comments drafted, not posted.');

  const client = new LinkedInClient();
  try {
    await client.init();
    await client.ensureLoggedIn();

    // Deduplicate against previously posted URLs (last 2 weeks)
    const previouslyEngaged = getPostedUrls();

    // Discover posts across all topics
    const seenUrls = new Set<string>(previouslyEngaged);
    const candidates: DiscoveredPost[] = [];

    for (const topic of client.searchTopics) {
      if (candidates.length >= MAX_PER_DAY * 2) break; // collect a buffer, deduplicate after

      console.log(`\nSearching: "${topic}"`);
      const posts = await client.searchRecentPosts(topic);
      console.log(`  Found ${posts.length} posts`);

      for (const post of posts) {
        if (!seenUrls.has(post.url)) {
          seenUrls.add(post.url);
          candidates.push(post);
        }
      }

      await sleep(3000);
    }

    console.log(`\n${candidates.length} unique new posts found. Engaging with up to ${MAX_PER_DAY}...\n`);

    let engaged = 0;

    for (const post of candidates) {
      if (engaged >= MAX_PER_DAY) break;

      console.log(`\n[${engaged + 1}/${MAX_PER_DAY}] ${post.author_name}`);
      console.log(`  ${post.url}`);

      try {
        // Fetch full post content and existing comments from the post page
        const { content, existingComments } = await client.getPostContent(post.url);
        const fullContent = content || post.post_content;

        // Check if already commented on this post
        if (MY_NAME && await client.hasAlreadyCommented(MY_NAME)) {
          console.log('  Already commented — skipping.');
          logEngagement({
            author_name: post.author_name,
            post_url: post.url,
            comment_text: '',
            timestamp: new Date().toISOString(),
            status: 'skipped_already_commented',
          });
          continue;
        }

        // Generate comment via Claude
        const comment = await generateComment(fullContent, existingComments);

        if (DRY_RUN) {
          console.log(`  Draft comment: "${comment}"`);
          logEngagement({
            author_name: post.author_name,
            post_url: post.url,
            comment_text: comment,
            timestamp: new Date().toISOString(),
            status: 'dry_run',
          });
          engaged++;
          continue;
        }

        // Post the comment
        const success = await client.commentOnPost(post.url, comment);

        if (success) {
          // Like the post (already on the post page from commentOnPost)
          await client.likePost();

          // Follow the author
          if (post.author_profile_url) {
            await client.followAuthor(post.author_profile_url);
          }

          logEngagement({
            author_name: post.author_name,
            post_url: post.url,
            comment_text: comment,
            timestamp: new Date().toISOString(),
            status: 'comment_posted',
          });

          engaged++;

          // Wait between comments to avoid triggering LinkedIn's spam detection
          if (engaged < MAX_PER_DAY && candidates.indexOf(post) < candidates.length - 1) {
            const delayMin = Math.round(DELAY_MS / 60000);
            console.log(`  Waiting ${delayMin} minutes before next comment...`);
            await sleep(DELAY_MS);
          }
        } else {
          console.warn('  Comment failed — LinkedIn DOM may have changed or session expired.');
          logEngagement({
            author_name: post.author_name,
            post_url: post.url,
            comment_text: comment,
            timestamp: new Date().toISOString(),
            status: 'comment_failed',
          });
        }
      } catch (err) {
        console.error(`  Error:`, err instanceof Error ? err.message : err);
        logEngagement({
          author_name: post.author_name,
          post_url: post.url,
          comment_text: '',
          timestamp: new Date().toISOString(),
          status: 'comment_failed',
        });
      }
    }

    console.log(`\nDaily engagement complete. Commented on ${engaged} posts.`);
  } finally {
    await client.close();
  }
}
