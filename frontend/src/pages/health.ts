import type { APIRoute } from 'astro';

// GIT_SHA is baked into the deployed image (frontend/Dockerfile); the deploy checks it here.
const commit = process.env.GIT_SHA;

export const GET: APIRoute = () => Response.json(
  { status: 'ok', service: 'umi-frontend', ...(commit ? { commit } : {}) },
  { headers: { 'cache-control': 'no-store' } },
);
