"use strict";
import { handleRequest } from './src/api/index.js';

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};