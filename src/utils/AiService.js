export class AiService {
    static async generateSql(provider, apiKey, model, prompt, context) {
        switch (provider) {
            case 'openai':
                return await this.callOpenAI(apiKey, model, prompt, context);
            case 'gemini':
                return await this.callGemini(apiKey, model, prompt, context);
            case 'anthropic':
                return await this.callAnthropic(apiKey, model, prompt, context);
            case 'deepseek':
                return await this.callDeepSeek(apiKey, model, prompt, context);
            case 'groq':
                return await this.callGroq(apiKey, model, prompt, context);
            case 'mistral':
                return await this.callMistral(apiKey, model, prompt, context);
            case 'local':
                return await this.callLocalAI(apiKey, model, prompt, context);
            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    static async analyzeQueryProfile(provider, apiKey, model, metrics) {
        const prompt = `
Please analyze these SQL execution metrics and explain the performance characteristics in a concise, developer-friendly way.
If there are issues (like slow duration, high rows examined vs returned, or disk temp tables), explain WHY they happened and HOW to fix them.

METRICS:
Query: ${metrics.query}
Duration: ${metrics.duration}ms
Rows Returned: ${metrics.rowsReturned}
Rows Examined: ${metrics.rowsExamined}
Tmp Tables: ${metrics.tmpTables}
Tmp Disk Tables: ${metrics.tmpDiskTables}
Full Join Scans: ${metrics.selectFullJoin}
Full Table Scans: ${metrics.selectScan}
Lock Wait Time: ${metrics.lockTime}ms
Network Sent/Received: ${metrics.bytesSent}/${metrics.bytesReceived} bytes

Format your response as a short, bulleted technical analysis. Max 150 words.
`;

        switch (provider) {
            case 'openai':
                return await this.callOpenAI(apiKey, model, prompt, "Execution Analysis Context");
            case 'gemini':
                return await this.callGemini(apiKey, model, prompt, "Execution Analysis Context");
            case 'anthropic':
                return await this.callAnthropic(apiKey, model, prompt, "Execution Analysis Context");
            case 'deepseek':
                return await this.callDeepSeek(apiKey, model, prompt, "Execution Analysis Context");
            case 'groq':
                return await this.callGroq(apiKey, model, prompt, "Execution Analysis Context");
            case 'mistral':
                return await this.callMistral(apiKey, model, prompt, "Execution Analysis Context");
            case 'local':
                return await this.callLocalAI(apiKey, model, prompt, "Execution Analysis Context");
            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    static async callOpenAI(apiKey, model, prompt, context) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: "system",
                        content: this.getSystemPrompt(context)
                    },
                    {
                        role: "user",
                        content: `Schema Context:\n${context}\n\nRequest: ${prompt}`
                    }
                ],
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `OpenAI Error: ${response.status}`);
        }

        const data = await response.json();
        return this.cleanSQL(data.choices[0]?.message?.content || '');
    }

    static async callGemini(apiKey, model, prompt, context) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const systemPrompt = this.getSystemPrompt(context);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: `User Request: ${prompt}` }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Gemini Error: ${response.status}`);
        }

        const data = await response.json();
        return this.cleanSQL(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
    }

    static async callAnthropic(apiKey, model, prompt, context) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'dangerously-allow-browser': 'true'
            },
            body: JSON.stringify({
                model: model,
                messages: [{
                    role: "user",
                    content: `${this.getSystemPrompt(context)}\n\nSchema Context:\n${context}\n\nUser Request: ${prompt}`
                }],
                max_tokens: 1024,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Anthropic Error: ${response.status}`);
        }

        const data = await response.json();
        return this.cleanSQL(data.content?.[0]?.text || '');
    }

    static async callDeepSeek(apiKey, model, prompt, context) {
        return await this.callOpenAICompatible(apiKey, 'https://api.deepseek.com/v1/chat/completions', model, prompt, context, 'DeepSeek');
    }

    static async callGroq(apiKey, model, prompt, context) {
        return await this.callOpenAICompatible(apiKey, 'https://api.groq.com/openai/v1/chat/completions', model, prompt, context, 'Groq');
    }

    static async callMistral(apiKey, model, prompt, context) {
        return await this.callOpenAICompatible(apiKey, 'https://api.mistral.ai/v1/chat/completions', model, prompt, context, 'Mistral');
    }

    static async callLocalAI(apiKey, model, prompt, context) {
        const baseUrl = localStorage.getItem('local_base_url') || 'http://localhost:11434/v1';
        const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
        return await this.callOpenAICompatible(apiKey, url, model, prompt, context, 'Local AI');
    }

    static async callOpenAICompatible(apiKey, url, model, prompt, context, providerName) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: this.getSystemPrompt(context) },
                    { role: "user", content: `Schema Context:\n${context}\n\nRequest: ${prompt}` }
                ],
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `${providerName} Error: ${response.status}`);
        }

        const data = await response.json();
        return this.cleanSQL(data.choices[0]?.message?.content || '');
    }

    static getSystemPrompt(context) {
        const dialect = context.split('\n')[0] || 'SQL';
        return `You are an expert SQL assistant. 
Your task is to generate valid SQL queries based on the user's natural language request and the provided database schema.

STRICT EXECUTION RULES:
1. Return ONLY the SQL query. No markdown, no explanations.
2. NO HALLUCINATIONS: You MUST ONLY use table and column names explicitly listed in the "Schema Summary". 
3. COLUMN SANITY CHECK: If a user asks for a column that doesn't exist, check for synonyms or OMIT it. NEVER guess.
4. Dialect: Use the dialect for ${dialect}.`;
    }

    static cleanSQL(sql) {
        return sql.replace(/^```sql\n/, '').replace(/^```/, '').replace(/```$/, '').trim();
    }
}
