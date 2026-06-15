import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You write authentic LinkedIn comments for someone genuinely curious about how AI is transforming therapy and wellness.

Rules:
- 3-4 sentences only
- Reference something SPECIFIC from the post — never generic praise
- Add one genuine insight or ask one substantive question about AI in this space
- Sound like a curious practitioner, not a marketer
- NEVER mention any company, product, or app (yours or anyone else's)
- No pitching, no selling, no self-promotion
- End with a real question when it fits naturally
- Avoid filler phrases like "Great post!" or "This is so insightful!"

Tone example: "The distinction you draw between [X] and [Y] is worth sitting with. I've been wondering whether [related angle]—does your experience suggest [genuine inquiry]?"`;

export async function generateComment(
  postContent: string,
  existingComments: string = ''
): Promise<string> {
  const prompt = existingComments
    ? `Write a comment for this LinkedIn post. The following comments already exist—do not repeat their angles:\n\nEXISTING COMMENTS:\n${existingComments}\n\nPOST:\n${postContent.slice(0, 2500)}`
    : `Write a comment for this LinkedIn post:\n\n${postContent.slice(0, 2500)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as Anthropic.TextBlock).text.trim();
}

export async function generateWeeklyPost(engagementSummary: string): Promise<{
  themes: string[];
  key_conversations: string[];
  post_text: string;
}> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: `You are analyzing a week of conversations in the AI therapy and wellness space on LinkedIn.

Here is a summary of posts and comments from this week:
${engagementSummary}

Return a JSON object with exactly these fields:
{
  "themes": ["theme 1", "theme 2", "theme 3"],
  "key_conversations": ["conversation 1", "conversation 2", "conversation 3"],
  "post_text": "A 150-200 word LinkedIn post sharing one genuine observation or insight about where this space is heading. Rules: about the space/trends only, not about your own work; no company names; ends with a thought-provoking question; no excessive emojis."
}

Return only valid JSON, no other text.`,
      },
    ],
  });

  const text = (response.content[0] as Anthropic.TextBlock).text.trim();
  return JSON.parse(text);
}
