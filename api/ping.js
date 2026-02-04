export default function handler(req, res) {
  return res.status(200).json({ pong: true, timestamp: new Date().toISOString() });
}
