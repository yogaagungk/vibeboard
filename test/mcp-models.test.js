'use strict';
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const models = require('../mcp-server/models');

const FIXTURE = {
  'claude-code': [
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', description: 'Most capable' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Balanced performance' },
  ],
  'opencode': [
    { id: 'opencode/deepseek-v4', name: 'Deepseek V4', description: 'opencode' },
  ],
  'codex': [
    { id: 'gpt-5-codex', name: 'GPT-5 Codex', description: 'Codex-tuned' },
  ],
};

const tools = {};
const mockMcp = {
  tool(name, _description, _schema, handler) {
    tools[name] = handler;
  },
};

const registerMcpTools = require('../mcp-server/mcp-tools');
registerMcpTools(mockMcp);

test('list_models without agent returns all agents', async () => {
  mock.method(models, 'getAvailableModels', () => JSON.parse(JSON.stringify(FIXTURE)));

  const result = await tools['list_models']({});
  const parsed = JSON.parse(result.content[0].text);

  assert.deepEqual(Object.keys(parsed), ['claude-code', 'opencode', 'codex']);
  assert.equal(parsed['claude-code'].length, 2);
  assert.equal(parsed['opencode'].length, 1);
  assert.equal(parsed['codex'].length, 1);
  assert.equal(parsed['claude-code'][0].id, 'claude-opus-4-8');
  assert.equal(parsed['claude-code'][0].name, 'Claude Opus 4.8');

  mock.reset();
});

test('list_models with agent filter returns only that agent', async () => {
  mock.method(models, 'getAvailableModels', () => JSON.parse(JSON.stringify(FIXTURE)));

  const result = await tools['list_models']({ agent: 'opencode' });
  const parsed = JSON.parse(result.content[0].text);

  assert.deepEqual(Object.keys(parsed), ['opencode']);
  assert.equal(parsed['opencode'].length, 1);
  assert.equal(parsed['opencode'][0].id, 'opencode/deepseek-v4');

  mock.reset();
});

test('list_models with unknown agent returns error', async () => {
  mock.method(models, 'getAvailableModels', () => JSON.parse(JSON.stringify(FIXTURE)));

  const result = await tools['list_models']({ agent: 'unknown' });
  const parsed = JSON.parse(result.content[0].text);

  assert.ok(parsed.error);
  assert.match(parsed.error, /unknown/i);

  mock.reset();
});
