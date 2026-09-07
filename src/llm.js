// src/llm.js - Streaming OpenAI / 9router Client with Thinking Token Support
import { config } from './config.js';

export class LLMClient {
  constructor() {
    this.maxRetries = 4;
  }

  async generateNextExperiment({ programPrompt, currentCode, history, lastError, onToken, onAction }) {
    const apiBase = config.get('OPENAI_API_BASE').replace(/\/+$/, '');
    const apiKey = config.get('OPENAI_API_KEY');
    const model = config.get('MODEL_NAME');

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured! Please set it in .env or the Web UI Settings.');
    }

    const systemPrompt = `You are an elite Autonomous AI Research Scientist working on Universal Sub-1-Bit Neural Quantization (< 1.0 BPW).
Your objective is to discover novel algorithmic compression techniques for Model A (Universal Neural Quantizer / Codec) in train.py.

Rules:
1. You may ONLY edit train.py.
2. Keep computations efficient (vectorized PyTorch, fast matrix multiplications, avoid O(N^3) operations). Must execute under 60s on CPU.
3. Your goal is to achieve BPW < 1.0 (ideally 0.5 - 0.8 BPW) while minimizing functional degradation on Canonical Neural IR.
4. Simplicity wins: do not introduce gratuitous complexity for tiny gains.
5. First, think deeply about the scientific mechanism, past experiment outcomes, and hypothesis.
6. You MUST format your response with:

<hypothesis>
A concise 1-2 sentence description of the scientific idea being tested.
</hypothesis>

<rationale>
Why this should improve BPW or functional degradation based on goal.md and prior results.
</rationale>

<code>
# Complete updated train.py code here
</code>`;

    let userPrompt = `### Autonomous Research Protocol (program.md):
${programPrompt}

### Recent Experiment History:
${history.length > 0 ? history.map(h => `- Iteration #${h.iteration} [${h.status}]: BPW=${h.bpw}, Deg=${h.degradation_pct}%, Pareto=${h.pareto_score} | Hypothesis: ${h.hypothesis}`).join('\n') : 'No prior experiments yet (only baseline #0).'}
`;

    if (lastError) {
      userPrompt += `\n### ATTENTION - Last Experiment Failed with Error:\n${lastError}\nFix the issue or choose a simpler, more robust approach.\n`;
    }

    userPrompt += `\n### Current train.py:\n\`\`\`python\n${currentCode}\n\`\`\`\n\nThink through the research challenge, formulate your hypothesis, and provide the complete modified train.py:`;

    const payload = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    };

    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        const url = `${apiBase}/chat/completions`;
        onAction?.(`Connecting to LLM API (${model} via ${apiBase})...`);

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (resp.status === 429 || resp.status >= 500) {
          const waitSec = Math.min(45, Math.pow(2, attempt) * 3 + Math.random() * 2);
          onAction?.(`Rate limited (HTTP ${resp.status}). Retrying in ${waitSec.toFixed(1)}s (Attempt ${attempt + 1}/${this.maxRetries})...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          attempt++;
          continue;
        }

        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`LLM API returned HTTP ${resp.status}: ${errText.slice(0, 300)}`);
        }

        // Stream reader loop
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullContent = '';
        let fullReasoning = '';
        let isInsideThinkingTag = false;

        onAction?.(`Streaming AI Scientist reasoning & code tokens...`);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep trailing incomplete segment

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const delta = json.choices?.[0]?.delta;
                if (!delta) continue;

                // 1. Dedicated reasoning content (Claude 3.7 Sonnet / DeepSeek R1)
                if (delta.reasoning_content) {
                  fullReasoning += delta.reasoning_content;
                  onToken?.({ type: 'thinking', token: delta.reasoning_content });
                }

                // 2. Standard content
                if (delta.content) {
                  const contentChunk = delta.content;
                  fullContent += contentChunk;

                  // Check for <thinking> XML tags inside content
                  if (contentChunk.includes('<thinking>')) {
                    isInsideThinkingTag = true;
                  }

                  if (isInsideThinkingTag) {
                    onToken?.({ type: 'thinking', token: contentChunk });
                    if (contentChunk.includes('</thinking>')) {
                      isInsideThinkingTag = false;
                    }
                  } else {
                    onToken?.({ type: 'content', token: contentChunk });
                  }
                }
              } catch (parseErr) {
                // Ignore partial JSON line
              }
            }
          }
        }

        return this.parseResponse(fullContent, fullReasoning);
      } catch (err) {
        attempt++;
        if (attempt >= this.maxRetries) throw err;
        const waitSec = Math.min(30, Math.pow(2, attempt) * 2);
        onAction?.(`Network hiccup: ${err.message}. Retrying in ${waitSec}s...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }

  parseResponse(content, reasoning) {
    const hypothesisMatch = content.match(/<hypothesis>([\s\S]*?)<\/hypothesis>/i);
    const rationaleMatch = content.match(/<rationale>([\s\S]*?)<\/rationale>/i);
    let codeMatch = content.match(/<code>([\s\S]*?)<\/code>/i);

    if (!codeMatch) {
      codeMatch = content.match(/```(?:python)?([\s\S]*?)```/i);
    }

    let code = codeMatch ? codeMatch[1].trim() : null;
    if (code && code.startsWith('```python')) {
      code = code.replace(/^```python\s*/, '').replace(/```$/, '').trim();
    }

    return {
      hypothesis: hypothesisMatch ? hypothesisMatch[1].trim() : 'Experimental code mutation',
      rationale: rationaleMatch ? rationaleMatch[1].trim() : '',
      code: code,
      reasoning: reasoning || '',
      raw: content,
    };
  }
}

export const llm = new LLMClient();
