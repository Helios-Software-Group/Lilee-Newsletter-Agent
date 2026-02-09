import '../lib/env.js';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL!;

interface SlackNotificationPayload {
  draftUrl: string;
  issueDate: string;
  title: string;
  highlights: string;
  suggestedCollateral: string[];
  reviewQuestions: string[];
}

/**
 * Send a Slack notification about the newsletter draft
 */
async function sendSlackNotification(payload: SlackNotificationPayload): Promise<void> {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📰 Newsletter Draft Ready for Review',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${payload.title}*\n${payload.highlights}`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Issue Date:*\n${payload.issueDate}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\nDraft`,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📝 Review Draft in Notion',
            emoji: true,
          },
          url: payload.draftUrl,
          style: 'primary',
        },
      ],
    },
  ];

  // Add suggested collateral section if present
  if (payload.suggestedCollateral.length > 0) {
    blocks.push(
      {
        type: 'divider',
      } as any,
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📎 Suggested Collateral:*\n' + payload.suggestedCollateral.map(c => `• ${c}`).join('\n'),
        },
      } as any
    );
  }

  // Add review questions section if present
  if (payload.reviewQuestions.length > 0) {
    blocks.push(
      {
        type: 'divider',
      } as any,
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*❓ Questions to Address:*\n' + payload.reviewQuestions.map(q => `• ${q}`).join('\n'),
        },
      } as any
    );
  }

  // Add footer with instructions
  blocks.push(
    {
      type: 'divider',
    } as any,
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '💡 *Next steps:* Review the draft, add collateral, record video, then set Status to "Ready" in Notion when ready to send.',
        },
      ],
    } as any
  );

  const slackMessage = {
    blocks,
    text: `Newsletter draft ready: ${payload.title}`, // Fallback for notifications
  };

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slackMessage),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Main function - can be called with payload or run standalone for testing
 */
async function notifySlack(payload?: SlackNotificationPayload) {
  if (!SLACK_WEBHOOK_URL || SLACK_WEBHOOK_URL === 'https://hooks.slack.com/services/...') {
    console.log('⚠️  Slack webhook URL not configured. Skipping notification.');
    console.log('   Set SLACK_WEBHOOK_URL in .env to enable Slack notifications.');
    return;
  }

  // If no payload provided, use test data
  const testPayload: SlackNotificationPayload = payload || {
    draftUrl: 'https://notion.so/test-newsletter',
    issueDate: new Date().toISOString().split('T')[0],
    title: 'Lilee Product Update — Test',
    highlights: 'This is a test notification for the newsletter system.',
    suggestedCollateral: ['Screenshot of new workflow', 'Demo video'],
    reviewQuestions: ['Should we include TAT metrics?', 'Is the framing right for compliance?'],
  };

  console.log('📤 Sending Slack notification...');
  await sendSlackNotification(testPayload);
  console.log('✅ Slack notification sent successfully!');
}

// Run if called directly
if (process.argv[1]?.includes('slack')) {
  notifySlack().catch(console.error);
}

export { notifySlack, sendSlackNotification };
export type { SlackNotificationPayload };
