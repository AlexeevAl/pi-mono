import { createServer } from 'node:http';

const port = 3050;

createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-PSF-Edge-Id, X-PSF-Agent-Role, X-PSF-Channel, Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- CLIENT API ---

  // Path: /api/agent/context/:userId
  if (url.pathname.startsWith('/api/agent/context/')) {
    const userId = url.pathname.split('/').pop();
    console.log(`[Proxy] CLIENT: GET Context for ${userId}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      context: {
        utterance: "Привет! Я Линда. О чем вы хотели бы поговорить?",
        allowedIntents: [
          { id: "start_intake", label: "📋 Начать опрос" },
          { id: "ask_question", label: "❓ Задать вопрос" }
        ],
        mode: "INTENT",
        worldId: "linda-world",
        activeSkill: "manager",
        relationshipState: "new_patient",
        conversationGoal: "collect_initial_complaint"
      }
    }));
    return;
  }

  // --- ADMIN API ---

  // Path: /api/admin/sessions
  if (url.pathname === '/api/admin/sessions') {
    console.log(`[Proxy] ADMIN: List Sessions`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      { sessionId: "243301978492997", status: "active", lastUtterance: "Hi", createdAt: new Date().toISOString() },
      { sessionId: "79991234567", status: "idle", lastUtterance: "Когда прием?", createdAt: new Date().toISOString() }
    ]));
    return;
  }

  // Path: /api/admin/sessions/:id
  if (url.pathname.startsWith('/api/admin/sessions/')) {
    const sessionId = url.pathname.split('/').pop();
    console.log(`[Proxy] ADMIN: View Session ${sessionId}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sessionId,
      status: "active",
      context: {
        relationshipState: "new_patient",
        conversationGoal: "collect_initial_complaint"
      },
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Здравствуйте! Чем могу помочь?" }
      ]
    }));
    return;
  }

  console.log(`[Proxy] 404 Not Found: ${url.pathname}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: "not_found", path: url.pathname }));
}).listen(port, () => {
  console.log(`\x1b[32m[Proxy] Linda Mock Backend UPDATED (V5 - ADMIN SUPPORT) on port ${port}\x1b[0m`);
});
