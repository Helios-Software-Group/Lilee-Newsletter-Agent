/**
 * Vercel Serverless Function - Newsletter Agent Webhook
 *
 * This endpoint receives webhooks from Notion when a new meeting note is created.
 * It triggers the Newsletter Agent to enrich the meeting with attendee information.
 *
 * Endpoint: POST /api/webhook
 *
 * Request Body:
 * {
 *   "meetingId": "notion-page-id",
 *   "meetingDate": "2026-02-03T14:00:00Z",
 *   "meetingName": "ACV Weekly Call"
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { enrichMeeting } from '../src/meetings/enrich.js';

// Simple webhook secret validation (optional)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/**
 * Validate the incoming webhook request
 */
function validateRequest(req: VercelRequest): { valid: boolean; error?: string } {
  // Check method
  if (req.method !== 'POST') {
    return { valid: false, error: 'Method not allowed. Use POST.' };
  }

  // Check webhook secret if configured
  if (WEBHOOK_SECRET) {
    const providedSecret = req.headers['x-webhook-secret'] as string;
    if (providedSecret !== WEBHOOK_SECRET) {
      return { valid: false, error: 'Invalid webhook secret' };
    }
  }

  // Validate body
  const { meetingId, meetingDate, meetingName } = req.body || {};

  if (!meetingId) {
    return { valid: false, error: 'Missing required field: meetingId' };
  }

  if (!meetingDate) {
    return { valid: false, error: 'Missing required field: meetingDate' };
  }

  if (!meetingName) {
    return { valid: false, error: 'Missing required field: meetingName' };
  }

  return { valid: true };
}

/**
 * Main webhook handler
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  console.log('📨 Webhook received:', new Date().toISOString());

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-webhook-secret');
    return res.status(200).end();
  }

  // Validate request
  const validation = validateRequest(req);
  if (!validation.valid) {
    console.error('❌ Validation failed:', validation.error);
    return res.status(400).json({
      success: false,
      error: validation.error,
    });
  }

  const { meetingId, meetingDate, meetingName } = req.body;

  console.log('📋 Processing meeting:', {
    meetingId,
    meetingDate,
    meetingName,
  });

  try {
    // Run the agent to enrich the meeting
    const result = await enrichMeeting(meetingId, meetingDate, meetingName);

    if (result.success) {
      console.log('✅ Meeting enriched successfully');
      return res.status(200).json({
        success: true,
        message: 'Meeting enriched successfully',
        result: result.result,
      });
    } else {
      console.error('❌ Agent failed:', result.error);
      return res.status(500).json({
        success: false,
        error: result.error || 'Agent execution failed',
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Webhook handler error:', errorMessage);
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}

/**
 * Vercel configuration for this function
 */
export const config = {
  maxDuration: 300, // 5 minutes max for agent execution
};
