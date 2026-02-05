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
        return await this.generateResponse(provider, apiKey, model, prompt, "EXPLAIN");
    }

    static async recommendIndexes(provider, apiKey, model, context) {
        const prompt = `
You are an expert database performance engineer. Analyze the following table schema and query patterns to recommend optimal indexes.

TABLE: ${context.table}
DATABASE: ${context.database}

COLUMNS:
${JSON.stringify(context.columns, null, 2)}

EXISTING INDEXES:
${JSON.stringify(context.existingIndexes, null, 2)}

QUERY PATTERNS (from query history):
${JSON.stringify(context.queryPatterns, null, 2)}

Based on this analysis, provide index recommendations in the following JSON format:
{
  "recommendations": [
    {
      "columns": ["column1", "column2"],
      "indexType": "BTREE",
      "reason": "Detailed explanation of why this index is needed",
      "impactScore": 85,
      "affectedQueries": ["Example query 1", "Example query 2"],
      "estimatedBenefit": "~40% faster queries",
      "createSql": "CREATE INDEX idx_name ON table (columns);"
    }
  ],
  "analysisSummary": "Brief summary of the analysis"
}

Important:
1. Only recommend indexes that don't already exist
2. Focus on columns frequently used in WHERE, JOIN, ORDER BY clauses
3. Consider composite indexes for multi-column filters
4. Provide realistic impact scores (0-100)
5. Include actual CREATE INDEX SQL statements
6. Limit to top 5 most impactful recommendations

Respond ONLY with the JSON object, no markdown formatting.`;

        try {
            const response = await this.generateResponse(provider, apiKey, model, prompt, "RECOMMEND_INDEX", context);
            // Try to parse JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            // If no JSON found, return structured error
            return {
                recommendations: [],
                analysisSummary: "Failed to parse AI response",
                error: response
            };
        } catch (error) {
            console.error('AI Index Recommendation Error:', error);
            return {
                recommendations: [],
                analysisSummary: "Error getting AI recommendations: " + error.message,
                error: error.message
            };
        }
    }

    static async explainQuery(provider, apiKey, model, sql, context) {
        const prompt = `Explain what this SQL query does in plain English. Break it down step by step if it's complex.\n\nSQL:\n${sql}`;
        return await this.generateResponse(provider, apiKey, model, prompt, "EXPLAIN", context);
    }

    static async optimizeQuery(provider, apiKey, model, sql, context) {
        const prompt = `Analyze this SQL query and suggest performance or readability optimizations (e.g., adding indexes, using JOINs instead of subqueries, or better naming). Return the optimized SQL and a brief explanation of the changes.\n\nSQL:\n${sql}`;
        return await this.generateResponse(provider, apiKey, model, prompt, "OPTIMIZE", context);
    }

    static async fixQueryError(provider, apiKey, model, sql, error, context) {
        const prompt = `This SQL query failed with the following error. Please analyze the code and the error, then provide a working fix.\n\nSQL:\n${sql}\n\nERROR:\n${error}`;
        return await this.generateResponse(provider, apiKey, model, prompt, "FIX", context);
    }

    static async generateResponse(provider, apiKey, model, prompt, mode, context = "") {
        switch (provider) {
            case 'openai':
                return await this.callOpenAI(apiKey, model, prompt, context, mode);
            case 'gemini':
                return await this.callGemini(apiKey, model, prompt, context, mode);
            case 'anthropic':
                return await this.callAnthropic(apiKey, model, prompt, context, mode);
            case 'deepseek':
                return await this.callDeepSeek(apiKey, model, prompt, context, mode);
            case 'groq':
                return await this.callGroq(apiKey, model, prompt, context, mode);
            case 'mistral':
                return await this.callMistral(apiKey, model, prompt, context, mode);
            case 'local':
                return await this.callLocalAI(apiKey, model, prompt, context, mode);
            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    static async callOpenAI(apiKey, model, prompt, context, mode = "GEN") {
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
                        content: this.getSystemPrompt(context, mode)
                    },
                    {
                        role: "user",
                        content: `Schema Context:\n${context}\n\nRequest: ${prompt}`
                    }
                ],
                temperature: mode === 'GEN' ? 0.1 : 0.3
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `OpenAI Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || '';
        return mode === 'GEN' ? this.cleanSQL(content) : content;
    }

    static async callGemini(apiKey, model, prompt, context, mode = "GEN") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const systemPrompt = this.getSystemPrompt(context, mode);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: `User Request: ${prompt}` }] }],
                generationConfig: { temperature: mode === 'GEN' ? 0.1 : 0.3, maxOutputTokens: 2048 }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Gemini Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return mode === 'GEN' ? this.cleanSQL(content) : content;
    }

    static async callAnthropic(apiKey, model, prompt, context, mode = "GEN") {
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
                    content: `${this.getSystemPrompt(context, mode)}\n\nSchema Context:\n${context}\n\nUser Request: ${prompt}`
                }],
                max_tokens: 2048,
                temperature: mode === 'GEN' ? 0.1 : 0.3
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Anthropic Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.content?.[0]?.text || '';
        return mode === 'GEN' ? this.cleanSQL(content) : content;
    }

    static async callDeepSeek(apiKey, model, prompt, context, mode = "GEN") {
        return await this.callOpenAICompatible(apiKey, 'https://api.deepseek.com/v1/chat/completions', model, prompt, context, 'DeepSeek', mode);
    }

    static async callGroq(apiKey, model, prompt, context, mode = "GEN") {
        return await this.callOpenAICompatible(apiKey, 'https://api.groq.com/openai/v1/chat/completions', model, prompt, context, 'Groq', mode);
    }

    static async callMistral(apiKey, model, prompt, context, mode = "GEN") {
        return await this.callOpenAICompatible(apiKey, 'https://api.mistral.ai/v1/chat/completions', model, prompt, context, 'Mistral', mode);
    }

    static async callLocalAI(apiKey, model, prompt, context, mode = "GEN") {
        const baseUrl = localStorage.getItem('local_base_url') || 'http://localhost:11434/v1';
        const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
        return await this.callOpenAICompatible(apiKey, url, model, prompt, context, 'Local AI', mode);
    }

    static async callOpenAICompatible(apiKey, url, model, prompt, context, providerName, mode = "GEN") {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: this.getSystemPrompt(context, mode) },
                    { role: "user", content: `Schema Context:\n${context}\n\nRequest: ${prompt}` }
                ],
                temperature: mode === 'GEN' ? 0.1 : 0.3
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `${providerName} Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || '';
        return mode === 'GEN' ? this.cleanSQL(content) : content;
    }

    static getSystemPrompt(context, mode = "GEN") {
        const dialect = context.split('\n')[0] || 'SQL';

        if (mode === 'EXPLAIN') {
            return `You are an expert SQL analyst. Explain the provided SQL query in a clear, concise, and technical manner. Focus on what the query aims to achieve and how it processes data according to the ${dialect} dialect. Use markdown for formatting.`;
        }

        if (mode === 'OPTIMIZE') {
            return `You are a Senior Database Administrator. Analyze the provided ${dialect} query for performance bottlenecks and readability issues. 
Provide an optimized version of the query inside a markdown SQL block, followed by a bulleted explanation of your changes (e.g., index hints, join optimizations, or readability improvements).`;
        }

        if (mode === 'FIX') {
            return `You are an expert SQL Developer. A query has failed with an error. 
Analyze the existing SQL and the error message in the context of the provided ${dialect} schema. 
Provide the corrected SQL query inside a markdown block, followed by a brief explanation of what was fixed.`;
        }

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
