'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const runtime = path.join(__dirname, '..', '.runtime');
const moduleFile = path.join(runtime, 'llm-node', 'node_modules', 'node-llama-cpp', 'dist', 'index.js');
const modelFile = process.env.LOCAL_LLM_MODEL_PATH || path.join(runtime, 'models', 'qwen', 'Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf');
let enginePromise;

function available() { return fs.existsSync(moduleFile) && fs.existsSync(modelFile); }

async function engine() {
    if (!enginePromise) enginePromise = (async () => {
        const api = await import(pathToFileURL(moduleFile).href);
        const llama = await api.getLlama({ gpu: false, build: 'never', logLevel: 'error' });
        const model = await llama.loadModel({ modelPath: modelFile });
        return { api, llama, model };
    })().catch(error => { enginePromise = null; throw error; });
    return enginePromise;
}

async function summarize(lines, instructions) {
    const { api, llama, model } = await engine();
    const context = await model.createContext({ contextSize: 8192, threads: 6 });
    const session = new api.LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: instructions });
    const grammar = await llama.createGrammarForJsonSchema({ type: 'object', properties: {
        summary: { type: 'string' }, category: { type: 'string' },
        keyPoints: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { index: { enum: lines.map((_, i) => i) }, text: { type: 'string' } }, required: ['index', 'text'] } },
        recommendations: { type: 'array', items: { type: 'string' } }
    }, required: ['summary', 'category', 'keyPoints', 'recommendations'] });
    try {
        const response = await session.prompt(JSON.stringify(lines.map((s, index) => ({ index, text: s.text }))), { grammar, maxTokens: 1400, temperature: 0.1 });
        return grammar.parse(response);
    } finally { session.dispose(); await context.dispose(); }
}

module.exports = { available, summarize };
