// Generates a direct iPhone Safari HD Video + Voice Call link (https://meet.livekit.io/custom?...)
// that dispatches `yukari-kasumiai` immediately, plus a scannable SVG QR widget for Hermes Desktop.
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { AccessToken } from 'livekit-server-sdk';
import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';

const url = process.env.LIVEKIT_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const agentName = process.env.MOBILE_AGENT_NAME || 'yukari-kasumiai-v2';

if (!url || !apiKey || !apiSecret) {
  throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set in .env.local');
}

const roomName = `yukari-call-${Date.now().toString(36)}`;
const at = new AccessToken(apiKey, apiSecret, {
  identity: 'ernesto-iphone',
  name: 'Ernesto (iPhone)',
  ttl: '6h',
});

at.addGrant({
  roomJoin: true,
  room: roomName,
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
});

at.roomConfig = new RoomConfiguration({
  name: roomName,
  agents: [new RoomAgentDispatch({ agentName })],
});

const jwt = await at.toJwt();
const callUrl = `https://meet.livekit.io/custom?liveKitUrl=${encodeURIComponent(url)}&token=${encodeURIComponent(jwt)}`;
const svgQr = await QRCode.toString(callUrl, { type: 'svg', margin: 1, width: 168 });

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  .card {
    border: 1px solid var(--border, rgba(157,140,255,0.35));
    background: var(--card, rgba(22,33,62,0.85));
    color: var(--foreground, #fff);
    border-radius: 16px;
    padding: 18px 20px;
    display: flex;
    align-items: center;
    gap: 20px;
    max-width: 640px;
  }
  .qr-box {
    background: #ffffff;
    padding: 10px;
    border-radius: 12px;
    flex-shrink: 0;
    width: 168px;
    height: 168px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qr-box svg { width: 148px; height: 148px; display: block; }
  .meta h3 { margin: 0 0 6px 0; font-size: 15px; font-weight: 700; }
  .meta p { margin: 0 0 10px 0; font-size: 13px; color: var(--muted-foreground, #b8c1d1); line-height: 1.45; }
  .btn {
    display: inline-block;
    padding: 8px 14px;
    border-radius: 10px;
    background: linear-gradient(90deg, #9D8CFF, #55DDE0);
    color: #0B1020;
    font-weight: 700;
    font-size: 12px;
    text-decoration: none;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="qr-box">
      ${svgQr}
    </div>
    <div class="meta">
      <h3>Direct iPhone HD Video Call → Kasumiai</h3>
      <p>Point your <strong>iPhone Camera</strong> at this QR code to open a direct HD Video + Voice call with Kasumiai in Safari. Tap <strong>Join</strong> — Kasumiai greets you automatically with HD video!</p>
      <a class="btn" href="${callUrl}" target="_blank" rel="noreferrer">Open Test Call on Laptop</a>
    </div>
  </div>
</body>
</html>`;

writeFileSync('C:/Users/flore/yukari-chert-agent/iphone-call-qr.html', html, 'utf8');
console.log('Generated room:', roomName, 'QR HTML ready.');
