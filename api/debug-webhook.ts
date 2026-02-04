/**
 * Debug endpoint to see exactly what Notion sends
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('🔍 DEBUG WEBHOOK');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));

  return res.status(200).json({
    success: true,
    received: {
      method: req.method,
      headers: req.headers,
      body: req.body,
    },
  });
}
