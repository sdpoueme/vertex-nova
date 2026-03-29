/**
 * WhatsApp webhook test server.
 * Handles webhook verification and incoming messages.
 */
import { createServer } from 'node:http';

var VERIFY_TOKEN = 'vertex-nova-whatsapp';
var WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
var PHONE_ID = process.env.WHATSAPP_PHONE_ID;
var API_BASE = 'https://graph.facebook.com/v21.0';

var server = createServer(function(req, res) {
  // Webhook verification (GET)
  if (req.method === 'GET' && req.url && req.url.startsWith('/webhook')) {
    var url = new URL(req.url, 'http://localhost:3001');
    var mode = url.searchParams.get('hub.mode');
    var token = url.searchParams.get('hub.verify_token');
    var challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified!');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
    } else {
      console.log('Verification failed. Token:', token);
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  // Incoming messages (POST)
  if (req.method === 'POST' && req.url === '/webhook') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      res.writeHead(200);
      res.end('OK');

      try {
        var data = JSON.parse(body);
        var entries = data.entry || [];
        for (var i = 0; i < entries.length; i++) {
          var changes = entries[i].changes || [];
          for (var j = 0; j < changes.length; j++) {
            if (changes[j].field !== 'messages') continue;
            var messages = changes[j].value && changes[j].value.messages || [];
            for (var k = 0; k < messages.length; k++) {
              var msg = messages[k];
              console.log('Message from ' + msg.from + ': ' + (msg.text && msg.text.body || '[non-text]'));

              // Reply
              if (msg.text && msg.text.body) {
                sendReply(msg.from, 'Vertex Nova a recu votre message: "' + msg.text.body + '"');
              }
            }
          }
        }
      } catch(err) {
        console.error('Parse error:', err.message);
      }
    });
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

function sendReply(to, text) {
  fetch(API_BASE + '/' + PHONE_ID + '/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + WHATSAPP_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: text },
    }),
  }).then(function(res) {
    if (!res.ok) {
      return res.text().then(function(err) {
        console.error('Send failed:', res.status, err);
      });
    }
    console.log('Reply sent to', to);
  }).catch(function(err) {
    console.error('Send error:', err.message);
  });
}

server.listen(3001, function() {
  console.log('WhatsApp webhook listening on port 3001');
  console.log('Tunnel URL: https://western-filtering-periodic-developments.trycloudflare.com/webhook');
  console.log('Verify token: ' + VERIFY_TOKEN);
});
