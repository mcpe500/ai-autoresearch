// src/llm.js - Universal OpenAI / 9router Compatible Client
import { config } from './config.js';

export class LLMClient {
  constructor() {
    this.maxRetries = 5;
  }

  async generateNextExperiment({ programPrompt, currentCode, history, lastError }) {
    const apiBase = config.get('OPENAI_API_BASE').replace(/\/+$/, '');
    const apiKey = config.get('OPENAI_API_KEY');
    const model = config.get('MODEL_NAME');

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured! Please set it in .env or the Web UI.');
    }

    const systemPrompt = `You are an elite Autonomous AI Research Scientist working on Universal Sub-1-Bit Neural Quantization.
Your objective is to discover novel algorithmic compression techniques for Model A (the Universal Neural Quantizer / Codec) in train.py.

Rules:
1. You may ONLY edit train.py.
2. The code must execute within 60 seconds on CPU. Keep matrix operations vectorized in PyTorch.
3. Your goal is to achieve BPW < 1.0 (ideally 0.5 - 0.8 BPW) while minimizing functional degradation.
4. Simplicity wins: do not introduce gratuitous complexity for tiny gains.
5. You MUST output your response in this exact format:

<hypothesis>
A concise 1-2 sentence description of the scientific idea being tested.
</hypothesis>

<rationale>
Why this should improve BPW or functional degradation based on goal.md and prior results.
</rationale>

<code>
# Complete updated train.py code here
</code>`;

    let userPrompt = `### Autonomous Research Context (from program.md):
${programPrompt}

### Recent Experiment History:
${history.length > 0 ? history.map(h => `- Iteration ${h.iteration} [${h.status}]: BPW=${h.bpw}, Deg=${h.degradation_pct}%, Pareto=${h.pareto_score} | Hypothesis: ${h.hypothesis}`).join('\n') : 'No prior experiments yet (only baseline).'}
`;

    if (lastError) {
      userPrompt += `\n### ATTENTION - Last Experiment Failed with Error:\n${lastError}\nFix the bug or pivot to a simpler approach.\n`;
    }

    userPrompt += `\n### Current train.py:\n\`\`\`python\n${currentCode}\n\`\`\`\n\nPropose the next research hypothesis and provide the complete modified train.py:`;

    const payload = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 4096,
    };

    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        const url = `${apiBase}/chat/completions`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (resp.status === 429 || resp.status >= 500) {
          const waitTime = Math.min(60, Math.pow(2, attempt) * 3 + Math.random() * 2);
          console.warn(`[LLM] HTTP ${resp.status}. Retrying in ${waitTime.toFixed(1)}s (Attempt ${attempt + 1}/${this.maxRetries})...`);
          await new Promise(r => setTimeout(r, waitTime * 1000));
          attempt++;
          continue;
        }

        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`LLM API returned HTTP ${resp.status}: ${errText}`);
        }

        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        return this.parseResponse(content);
      } catch (err) {
        attempt++;
        if (attempt >= this.maxRetries) throw err;
        const waitTime = Math.min(60, Math.pow(2, attempt) * 2);
        console.warn(`[LLM] Network error: ${err.message}. Retrying in ${waitTime}s...`);
        await new Promise(r => setTimeout(r, waitTime * 1000));
      }
    }
  }

  parseResponse(text) {
    const hypothesisMatch = text.match(/<hypothesis>([\s\S]*?)<\/hypothesis>/i);
    const rationaleMatch = text.match(/<rationale>([\s\S]*?)<\/rationale>/i);
    let codeMatch = text.match(/<code>([\s\S]*?)<\/code>/i);

    if (!codeMatch) {
      // Fallback: search for ```python ... ```
      codeMatch = text.match(/```(?:python)?([\s\S]*?)```/i);
    }

    let code = codeMatch ? codeMatch[1].trim() : null;
    if (code && code.startsWith('```python')) {
      code = code.replace(/^```python\s*/, '').replace(/```$/, '').trim();
    }

    return {
      hypothesis: hypothesisMatch ? hypothesisMatch[1].trim() : 'Experimental code mutation',
      rationale: rationaleMatch ? rationaleMatch[1].trim() : '',
      code: code,
      raw: text,
    };
  }
}

export const llm = new LLMClient();
