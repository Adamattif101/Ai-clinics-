export interface DiscoveredPost {
  url: string;
  author_name: string;
  author_profile_url: string;
  post_content: string;
  discovered_at: string;
  topic: string;
}

export interface EngagementLog {
  author_name: string;
  post_url: string;
  comment_text: string;
  timestamp: string;
  status: 'comment_posted' | 'comment_failed' | 'skipped_already_commented' | 'dry_run';
}

export interface WeeklyReflection {
  date: string;
  themes_observed: string[];
  posts_engaged_count: number;
  key_conversations: string[];
  post_text: string;
}
