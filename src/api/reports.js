"use strict";

export async function handleReports(request, env, ctx) {
  return new Response(JSON.stringify({ reports: [] }), {
    headers: { 'Content-Type': 'application/json' }
  });
}