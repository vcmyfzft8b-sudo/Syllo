export type HelpArticle = {
  slug: string;
  title: string;
  category: "Popular" | "Recording and notes" | "Account and access";
  content: string;
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "family-plan",
    title: "Family plan?",
    category: "Popular",
    content: `# Family plan

A shared family workspace is not supported yet.

For now, each account has its own note library, processing history, and exports.

## What you can do now

- sign in with the account that should own the notes
- share exported PDF or Markdown files manually
- use the same language settings for more consistent results`,
  },
  {
    slug: "gift-coconote",
    title: "Can I gift Nota?",
    category: "Popular",
    content: `# Gifting access

Gift codes are not included in this version yet.

If you want someone else to use Nota, the most practical option right now is to create their own account or share exported notes.

## What comes next

When the code flow is ready, it will connect to the **Redeem code** option in Settings.`,
  },
  {
    slug: "supported-language",
    title: "Do you support my language?",
    category: "Popular",
    content: `# Supported languages

The app can process multilingual material, but results are best when you pick the correct source language before creating a note.

## Recommendations

- choose the actual language of the recording or text before submitting
- shorter recordings help when languages are mixed
- technical English terms may stay in the final output when they are part of the source`,
  },
  {
    slug: "feature-request",
    title: "Feature request",
    category: "Popular",
    content: `# Suggest an improvement

The most useful request is a short, concrete description of your workflow.

It helps to include:

- what you were trying to achieve
- where you got stuck
- what result you expected
- whether the issue is about audio, text, PDF, or a link`,
  },
  {
    slug: "video-isnt-working",
    title: "Video link is not working",
    category: "Recording and notes",
    content: `# Video link issues

Nota can only process content that is publicly accessible and readable enough to summarize.

## Try this

- verify that the page does not require sign-in
- use the direct page URL
- if you have the material elsewhere, upload a PDF or paste the text`,
  },
  {
    slug: "audio-upload-issue",
    title: "I cannot upload audio",
    category: "Recording and notes",
    content: `# Audio upload issues

Supported formats are MP3, M4A, WAV, OGG, and WEBM.

## Checklist

- verify that the file is not corrupted
- stay under the current size limit
- if the audio came from a screen recorder, export it again
- try again from the home screen if the upload stopped earlier`,
  },
  {
    slug: "transcript-cut-short",
    title: "The transcript is too short or inaccurate",
    category: "Recording and notes",
    content: `# Transcript quality

Transcript quality depends on audio clarity, overlapping speakers, and the selected source language.

## How to improve results

- choose the correct language before processing
- enable multi-speaker capture for conversations
- reduce background noise
- split very long recordings into smaller parts`,
  },
  {
    slug: "redeem-code",
    title: "Redeem code",
    category: "Account and access",
    content: `# Redeeming a code

Promo and gift codes will be added in a later phase.

The entry point already exists in Settings so the flow can be connected without another redesign.`,
  },
  {
    slug: "privacy-policy",
    title: "Privacy policy",
    category: "Account and access",
    content: `# Privacy policy

Your notes stay tied to your account. Uploaded material is used for transcription, summaries, structured notes, exports, and in-app chat responses.

If you need stricter retention or deletion rules, use the support channel so the policy can be defined clearly before rollout.`,
  },
];

export const HELP_SECTIONS = [
  {
    title: "Popular",
    items: HELP_ARTICLES.filter((article) => article.category === "Popular"),
  },
  {
    title: "Recording and notes",
    items: HELP_ARTICLES.filter((article) => article.category === "Recording and notes"),
  },
  {
    title: "Account and access",
    items: HELP_ARTICLES.filter((article) => article.category === "Account and access"),
  },
];

export function getHelpArticle(slug: string) {
  return HELP_ARTICLES.find((article) => article.slug === slug) ?? null;
}
