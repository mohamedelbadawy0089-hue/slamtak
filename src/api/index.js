"use strict";

export function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  
  if (url.pathname === '/api/health') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Not found', { status: 404 });
}