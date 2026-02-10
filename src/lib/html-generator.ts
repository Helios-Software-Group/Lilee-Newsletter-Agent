/**
 * Shared HTML generator for Notion → email content conversion.
 *
 * Outputs bare semantic HTML that relies on the compiled MJML template's
 * stylesheet (email-template/index.html) for all visual styling.
 * Both the CLI (send-newsletter.ts) and webhook (api/newsletter-status.ts)
 * import from here — one pipeline, two entry points.
 */

// ── Types ──────────────────────────────────────────────

export interface ContentGeneratorOptions {
  /** Generate a table of contents from h1 headings (default: true) */
  includeToc?: boolean;
  /** Optional callback to upload images to permanent storage (e.g. Supabase) */
  uploadImage?: (url: string, pageId: string) => Promise<string | null>;
  /** Page ID passed to uploadImage callback */
  pageId?: string;
  /** Stop processing when these h2 headings are encountered */
  skipSections?: string[];
}

const DEFAULT_SKIP_SECTIONS = ['Collateral Checklist', 'Review Questions'];

const VIDEO_DOMAINS = [
  'loom.com',
  'screen.studio',
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'screencast',
];

// ── Rich text helpers ──────────────────────────────────

/**
 * Convert Notion rich_text array to HTML with semantic tags.
 * No inline styles — the template stylesheet handles all formatting.
 */
export function getRichText(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => {
    let text = t.plain_text || '';
    if (t.annotations?.underline) text = `<u>${text}</u>`;
    if (t.annotations?.bold) text = `<strong>${text}</strong>`;
    if (t.annotations?.italic) text = `<em>${text}</em>`;
    if (t.annotations?.code) text = `<code>${text}</code>`;
    if (t.href) text = `<a href="${t.href}">${text}</a>`;
    return text;
  }).join('');
}

/**
 * Extract plain text from Notion rich_text array (no HTML).
 */
export function getPlainText(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => t.plain_text || '').join('');
}

/**
 * Format highlights for the highlights data variable.
 * Keeps coral inline styles since highlights are injected into a different
 * template context (the highlights box), not the content area.
 */
export function formatHighlights(html: string): string {
  return html
    .replace(/\n/g, '<br>')
    .replace(
      /<strong>([^<]+)<\/strong>/g,
      '<strong style="color:#FE8383;font-weight:700;">$1</strong>'
    );
}

// ── Content generation ─────────────────────────────────

/**
 * Convert Notion blocks to semantic HTML for email content.
 *
 * The output relies entirely on the compiled MJML template's stylesheet
 * for visual presentation. Only `<img>` tags get inline `style="max-width:100%"`
 * because email clients need explicit image constraints.
 */
export async function generateContentHtml(
  blocks: any[],
  options: ContentGeneratorOptions = {},
): Promise<string> {
  const {
    includeToc = true,
    uploadImage,
    pageId = '',
    skipSections = DEFAULT_SKIP_SECTIONS,
  } = options;

  // First pass: collect h1 headings for table of contents
  const tocItems: { text: string }[] = [];
  if (includeToc) {
    for (const b of blocks) {
      if (b.type === 'heading_1') {
        const text = getPlainText(b.heading_1?.rich_text);
        if (text) tocItems.push({ text });
      }
    }
  }

  let html = '';
  let inBulletedList = false;
  let inNumberedList = false;

  const closeOpenLists = () => {
    if (inBulletedList) { html += '</ul>\n'; inBulletedList = false; }
    if (inNumberedList) { html += '</ol>\n'; inNumberedList = false; }
  };

  // Generate TOC
  if (tocItems.length > 0) {
    html += `<div class="toc-box">\n`;
    html += `<p>In This Issue</p>\n`;
    html += `<ul>\n`;
    tocItems.forEach((item, idx) => {
      html += `<li>${idx + 1}. ${item.text}</li>\n`;
    });
    html += `</ul>\n</div>\n`;
  }

  // Second pass: generate content
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const type = b.type;
    const nextBlock = blocks[i + 1];

    // Stop at editorial sections
    if (type === 'heading_2') {
      const headingText = getPlainText(b.heading_2?.rich_text);
      if (skipSections.includes(headingText)) {
        closeOpenLists();
        break;
      }
    }

    // Close lists when transitioning to non-list blocks
    if (type !== 'bulleted_list_item' && type !== 'numbered_list_item') {
      closeOpenLists();
    }

    switch (type) {
      case 'heading_1':
        html += `<h1>${getRichText(b.heading_1?.rich_text)}</h1>\n`;
        break;

      case 'heading_2':
        html += `<h2>${getRichText(b.heading_2?.rich_text)}</h2>\n`;
        break;

      case 'heading_3': {
        const h3Html = getRichText(b.heading_3?.rich_text);
        const h3Plain = getPlainText(b.heading_3?.rich_text);
        // Subsection labels (end with ":") → h4 pill, feature titles → h3
        if (h3Plain.trim().endsWith(':')) {
          html += `<h4>${h3Html}</h4>\n`;
        } else {
          html += `<h3>${h3Html}</h3>\n`;
        }
        break;
      }

      case 'paragraph': {
        const text = getRichText(b.paragraph?.rich_text);
        if (text) html += `<p>${text}</p>\n`;
        break;
      }

      case 'bulleted_list_item':
        if (!inBulletedList) {
          if (inNumberedList) { html += '</ol>\n'; inNumberedList = false; }
          html += '<ul>\n';
          inBulletedList = true;
        }
        html += `  <li>${getRichText(b.bulleted_list_item?.rich_text)}</li>\n`;
        break;

      case 'numbered_list_item':
        if (!inNumberedList) {
          if (inBulletedList) { html += '</ul>\n'; inBulletedList = false; }
          html += '<ol>\n';
          inNumberedList = true;
        }
        html += `  <li>${getRichText(b.numbered_list_item?.rich_text)}</li>\n`;
        break;

      case 'quote':
        html += `<blockquote>${getRichText(b.quote?.rich_text)}</blockquote>\n`;
        break;

      case 'divider':
        html += '<hr>\n';
        break;

      case 'callout':
        html += `<div class="callout">${getRichText(b.callout?.rich_text)}</div>\n`;
        break;

      case 'image': {
        let imageUrl = b.image?.file?.url || b.image?.external?.url;
        const caption = getPlainText(b.image?.caption);

        if (!imageUrl) break;

        // Upload to permanent storage if callback provided
        if (uploadImage && pageId) {
          const permanentUrl = await uploadImage(imageUrl, pageId);
          if (permanentUrl) imageUrl = permanentUrl;
        }

        // Check if next block is a video link (image + link = clickable thumbnail)
        const videoLink = detectVideoLink(nextBlock);

        if (videoLink) {
          html += `<a href="${videoLink}" target="_blank" style="display:block;text-decoration:none;">`;
          html += `<img src="${imageUrl}" alt="${caption}" style="max-width:100%;">`;
          html += `</a>\n`;
          html += `<p class="video-caption">Tap image to view video</p>\n`;
          i++; // Skip the video link block
        } else {
          html += `<img src="${imageUrl}" alt="${caption}" style="max-width:100%;">\n`;
          if (caption) {
            html += `<p class="image-caption">${caption}</p>\n`;
          }
        }
        break;
      }

      case 'video': {
        const videoUrl = b.video?.file?.url || b.video?.external?.url;
        if (videoUrl) {
          html += `<p><a href="${videoUrl}">Watch Video</a></p>\n`;
        }
        break;
      }

      case 'embed': {
        const embedUrl = b.embed?.url;
        if (!embedUrl) break;
        const isImage = /\.(gif|png|jpg|jpeg|webp)/i.test(embedUrl) || embedUrl.includes('giphy');
        if (isImage) {
          html += `<img src="${embedUrl}" alt="Embedded content" style="max-width:100%;">\n`;
        } else {
          html += `<p><a href="${embedUrl}">View Content</a></p>\n`;
        }
        break;
      }
    }
  }

  closeOpenLists();
  return html;
}

// ── Internal helpers ───────────────────────────────────

function detectVideoLink(nextBlock: any): string | null {
  if (!nextBlock) return null;

  let url = '';
  if (nextBlock.type === 'paragraph') {
    const rt = nextBlock.paragraph?.rich_text || [];
    url = rt[0]?.href || rt.map((t: any) => t.plain_text || '').join('');
  } else if (nextBlock.type === 'bookmark') {
    url = nextBlock.bookmark?.url || '';
  }

  if (url && VIDEO_DOMAINS.some(d => url.includes(d))) {
    return url;
  }
  return null;
}
