"use strict";
import { handleRequest } from '../../worker.js';

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};