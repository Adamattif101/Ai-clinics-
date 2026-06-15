import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { DiscoveredPost } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../.linkedin-session.json');

const SEARCH_TOPICS = [
  'AI therapy mental health support',
  'AI journaling emotional wellness',
  'AI wellbeing mindfulness self-care',
  'digital therapeutics mental health innovation',
  'AI mental health counseling',
];

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class LinkedInClient {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const contextOptions = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    };

    if (fs.existsSync(SESSION_FILE)) {
      try {
        const state = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
        this.context = await this.browser.newContext({ ...contextOptions, storageState: state });
        console.log('Loaded saved LinkedIn session.');
      } catch {
        this.context = await this.browser.newContext(contextOptions);
      }
    } else {
      this.context = await this.browser.newContext(contextOptions);
    }

    this.page = await this.context.newPage();
    // Block images and media to speed things up
    await this.page.route('**/*.{png,jpg,jpeg,gif,webp,mp4,mp3}', route => route.abort());
  }

  private get p(): Page {
    if (!this.page) throw new Error('Client not initialized — call init() first');
    return this.page;
  }

  async login(email: string, password: string): Promise<void> {
    console.log('Logging in to LinkedIn...');
    await this.p.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    await this.p.fill('#username', email);
    await this.p.fill('#password', password);
    await this.p.click('[data-litms-control-urn="login-submit"], [type=submit]');

    try {
      await this.p.waitForURL('**/feed/**', { timeout: 30000 });
    } catch {
      // May need 2FA or captcha — check current URL
      const url = this.p.url();
      if (url.includes('checkpoint') || url.includes('challenge')) {
        throw new Error(
          `LinkedIn requires verification. Please log in manually first and save the session:\n` +
          `  Run: npx ts-node src/index.ts setup --interactive\n` +
          `  Current URL: ${url}`
        );
      }
      throw new Error(`Login failed. Current URL: ${url}`);
    }

    // Save session for reuse
    const state = await this.context!.storageState();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
    console.log('Login successful. Session saved.');
  }

  async ensureLoggedIn(): Promise<void> {
    await this.p.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    const isLoggedIn = this.p.url().includes('/feed/') || this.p.url().includes('/home');
    if (!isLoggedIn) {
      const email = process.env.LINKEDIN_EMAIL;
      const password = process.env.LINKEDIN_PASSWORD;
      if (!email || !password) {
        throw new Error('LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in environment variables');
      }
      await this.login(email, password);
    } else {
      console.log('LinkedIn session is active.');
    }
  }

  async searchRecentPosts(topic: string): Promise<DiscoveredPost[]> {
    const encoded = encodeURIComponent(topic);
    const url = `https://www.linkedin.com/search/results/content/?keywords=${encoded}&datePosted=past-week&sortBy=date_posted`;

    await this.p.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(3000);

    // Dismiss any modals
    await this.p.keyboard.press('Escape').catch(() => {});

    const posts: DiscoveredPost[] = [];

    // LinkedIn search results use a list of result containers
    const resultItems = this.p.locator('.search-results__list > li, .reusable-search__result-container');
    const count = await resultItems.count().catch(() => 0);

    for (let i = 0; i < Math.min(count, 4); i++) {
      try {
        const item = resultItems.nth(i);
        const post = await this.extractPostFromSearchResult(item, topic);
        if (post) posts.push(post);
      } catch {
        // Skip unparseable items
      }
    }

    return posts;
  }

  private async extractPostFromSearchResult(
    item: Locator,
    topic: string
  ): Promise<DiscoveredPost | null> {
    // Author name — try multiple selectors for resilience
    const authorName = await item
      .locator('.update-components-actor__name span[aria-hidden="true"], .entity-result__title-text a')
      .first()
      .innerText()
      .catch(() => null);

    // Post URL — from the timestamp/share anchor
    const postUrl = await item
      .locator('a[href*="/posts/"], a[href*="activity"]')
      .first()
      .getAttribute('href')
      .catch(() => null);

    // Author profile URL
    const authorProfileUrl = await item
      .locator('.update-components-actor__meta-link, .entity-result__title-text a')
      .first()
      .getAttribute('href')
      .catch(() => null);

    // Post content
    const postContent = await item
      .locator(
        '.feed-shared-update-v2__description, .update-components-text, .search-results__hit-text'
      )
      .first()
      .innerText()
      .catch(() => null);

    if (!authorName || !postUrl || !postContent) return null;

    return {
      url: postUrl.startsWith('http') ? postUrl : `https://www.linkedin.com${postUrl}`,
      author_name: authorName.trim(),
      author_profile_url: authorProfileUrl
        ? authorProfileUrl.startsWith('http')
          ? authorProfileUrl
          : `https://www.linkedin.com${authorProfileUrl}`
        : '',
      post_content: postContent.trim(),
      discovered_at: new Date().toISOString(),
      topic,
    };
  }

  async getPostContent(postUrl: string): Promise<{ content: string; existingComments: string }> {
    await this.p.goto(postUrl, { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    const content = await this.p
      .locator('.feed-shared-update-v2__description, .update-components-text')
      .first()
      .innerText()
      .catch(() => '');

    // Get first few existing comments to avoid duplicating angles
    const commentTexts: string[] = [];
    const commentItems = this.p.locator('.comments-comment-item');
    const commentCount = await commentItems.count().catch(() => 0);

    for (let i = 0; i < Math.min(commentCount, 5); i++) {
      const text = await commentItems
        .nth(i)
        .locator('.comments-comment-item__main-content')
        .innerText()
        .catch(() => '');
      if (text) commentTexts.push(text.trim());
    }

    return {
      content,
      existingComments: commentTexts.join('\n---\n'),
    };
  }

  async hasAlreadyCommented(myName: string): Promise<boolean> {
    // Check if myName appears in the comments section of the current page
    const commentsText = await this.p
      .locator('.comments-comments-list')
      .innerText()
      .catch(() => '');
    return commentsText.toLowerCase().includes(myName.toLowerCase());
  }

  async commentOnPost(postUrl: string, comment: string): Promise<boolean> {
    await this.p.goto(postUrl, { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    // Expand "See more" if needed
    await this.p.locator('.see-more').first().click().catch(() => {});

    // Click the Comment button
    const commentBtn = this.p
      .locator('button[aria-label*="Comment"], .comment-button')
      .first();
    if (!(await commentBtn.isVisible().catch(() => false))) return false;
    await commentBtn.click();
    await sleep(1500);

    // Find the comment input
    const editor = this.p
      .locator('.ql-editor[data-placeholder*="comment"], .comments-comment-box__form .ql-editor')
      .first();
    if (!(await editor.isVisible().catch(() => false))) return false;

    await editor.click();
    await editor.fill('');
    // Type slowly to appear more human-like
    await this.p.keyboard.type(comment, { delay: 20 });
    await sleep(800);

    // Submit
    const submitBtn = this.p
      .locator(
        '.comments-comment-box__submit-button:not([disabled]), button[type=submit].comments-comment-box__submit-button'
      )
      .first();
    if (!(await submitBtn.isEnabled().catch(() => false))) return false;
    await submitBtn.click();
    await sleep(2500);

    return true;
  }

  async likePost(): Promise<boolean> {
    // Run on the current page (post should already be loaded)
    const likeBtn = this.p
      .locator('[aria-label*="React Like"], [aria-label*="Like"]')
      .first();

    if (!(await likeBtn.isVisible().catch(() => false))) return false;

    const isLiked = await likeBtn.getAttribute('aria-pressed').catch(() => 'false');
    if (isLiked === 'true') return true;

    await likeBtn.click();
    await sleep(1000);
    return true;
  }

  async followAuthor(authorProfileUrl: string): Promise<boolean> {
    if (!authorProfileUrl) return false;

    await this.p.goto(authorProfileUrl, { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // "Follow" button (not "Connect")
    const followBtn = this.p
      .locator('button[aria-label^="Follow"], button:has-text("Follow")')
      .first();

    if (!(await followBtn.isVisible().catch(() => false))) return false;

    // Don't follow if already following
    const label = await followBtn.getAttribute('aria-label').catch(() => '');
    if (label?.includes('Unfollow') || label?.includes('Following')) return true;

    await followBtn.click();
    await sleep(1500);
    return true;
  }

  async publishPost(text: string): Promise<boolean> {
    await this.p.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    const startPostBtn = this.p
      .locator('[aria-label="Start a post"], .share-box-feed-entry__trigger')
      .first();
    if (!(await startPostBtn.isVisible().catch(() => false))) return false;

    await startPostBtn.click();
    await sleep(1500);

    const editor = this.p
      .locator('.ql-editor[contenteditable="true"]')
      .first();
    if (!(await editor.isVisible().catch(() => false))) return false;

    await editor.click();
    await this.p.keyboard.type(text, { delay: 15 });
    await sleep(800);

    const postBtn = this.p
      .locator('button.share-actions__primary-action, button:has-text("Post")')
      .last();
    if (!(await postBtn.isEnabled().catch(() => false))) return false;

    await postBtn.click();
    await sleep(3000);
    return true;
  }

  get searchTopics(): string[] {
    return SEARCH_TOPICS;
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
