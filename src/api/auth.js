"use strict";

export async function handleAuth(request, env, ctx) {
  const url = new URL(request.url);
  
  if (url.pathname === '/api/auth/register-store' && request.method === 'POST') {
    const body = await request.json();
    return new Response(JSON.stringify({ status: 'created', store: body }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Not found', { status: 404 });
}