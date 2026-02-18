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

    static async analyzeSchemaImpact(provider, apiKey, model, impactInput = {}) {
        const context = this.buildSchemaImpactContext(impactInput);
        const prompt = `
Analyze the schema change context and explain the likely downstream impact.

Prioritize:
1. Breaking risks (views, procedures, jobs, app queries)
2. Data integrity risks (nullability, type compatibility, dropped defaults)
3. Runtime/performance side effects
4. A concrete mitigation and validation plan

Return concise markdown in this structure:
### Risk Summary
- ...
### Likely Failures
- ...
### Mitigation Plan
- ...
### Validation Checklist
- ...

Keep it practical and specific to the provided table/column names.
Important: Complete all 4 sections fully and do not end mid-sentence.
`;

        const firstAttempt = await this.generateResponse(provider, apiKey, model, prompt, "IMPACT", context);
        if (!this.isImpactAnalysisLikelyIncomplete(firstAttempt)) {
            return firstAttempt;
        }

        const retryPrompt = `
The previous response was incomplete or malformed.
Regenerate the full schema impact analysis from scratch.

Requirements:
- Include all sections: Risk Summary, Likely Failures, Mitigation Plan, Validation Checklist.
- Do not end mid-sentence.
- Do not include provider names (e.g., "gemini", "openai") as checklist values.
- Keep content specific to provided table and column names only.
`;

        const retryAttempt = await this.generateResponse(provider, apiKey, model, retryPrompt, "IMPACT", context);
        if (!this.isImpactAnalysisLikelyIncomplete(retryAttempt)) {
            return retryAttempt;
        }

        return retryAttempt.length > firstAttempt.length ? retryAttempt : firstAttempt;
    }

    static async analyzeQualityReport(provider, apiKey, model, qualityInput = {}) {
        const context = this.buildQualityContext(qualityInput);
        const prompt = `
Analyze the table quality report and provide practical remediation guidance.

Return concise markdown in this structure:
### Quality Risk Summary
- ...
### Root Cause Analysis
- ...
### Remediation Plan
- ...
### Remediation Scripts
Provide one or more SQL blocks (DELETE/UPDATE) to fix identified issues (e.g., duplicates, orphans). 
Wrap each SQL snippet in a markdown code block labeled with the issue it fixes.
Example:
#### Fix Duplicates
\`\`\`sql
DELETE FROM table WHERE ...;
\`\`\`

### Validation Queries
- ...

Rules:
- Use only provided table and column names.
- Keep recommendations safe for production rollout.
- If issues exist, include concrete SQL checks in Validation Queries.
- If no issues exist, provide a focused monitoring checklist instead of SQL fixes.
`;

        const firstAttempt = await this.generateResponse(provider, apiKey, model, prompt, "QUALITY", context);
        if (!this.isQualityAnalysisLikelyIncomplete(firstAttempt)) {
            return firstAttempt;
        }

        const retryPrompt = `
The previous response was incomplete.
Regenerate the full quality analysis with all sections:
- Quality Risk Summary
- Root Cause Analysis
- Remediation Plan
- Remediation Scripts
- Validation Queries

Do not end mid-sentence and keep recommendations tied to the provided columns/issues only.
`;

        const retryAttempt = await this.generateResponse(provider, apiKey, model, retryPrompt, "QUALITY", context);
        if (!this.isQualityAnalysisLikelyIncomplete(retryAttempt)) {
            return retryAttempt;
        }

        return retryAttempt.length > firstAttempt.length ? retryAttempt : firstAttempt;
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
        const maxTokens = (mode === 'IMPACT' || mode === 'QUALITY') ? 1400 : undefined;
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
                max_tokens: maxTokens,
                temperature: this.getTemperature(mode)
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
        const maxOutputTokens = (mode === 'IMPACT' || mode === 'QUALITY') ? 3072 : 2048;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: `Schema Context:\n${context}\n\nRequest: ${prompt}` }] }],
                generationConfig: { temperature: this.getTemperature(mode), maxOutputTokens }
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
        const maxTokens = (mode === 'IMPACT' || mode === 'QUALITY') ? 3072 : 2048;
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
                max_tokens: maxTokens,
                temperature: this.getTemperature(mode)
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
        const maxTokens = (mode === 'IMPACT' || mode === 'QUALITY') ? 1400 : undefined;
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
                max_tokens: maxTokens,
                temperature: this.getTemperature(mode)
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

        if (mode === 'IMPACT') {
            return `You are a senior database reliability engineer.
Analyze schema-change impact with production safety in mind.
Use only the supplied context. Do not invent tables or columns.
Focus on concrete failure modes, severity, mitigation SQL, and verification steps.
Return concise markdown with short bullets.`;
        }

        if (mode === 'QUALITY') {
            return `You are a senior data quality engineer.
Analyze table-quality findings with production safety in mind.
Use only the supplied context. Do not invent tables, columns, or metrics.
Focus on practical risk prioritization, likely root causes, and verifiable remediation steps.
Return concise markdown with short bullets and concrete SQL checks when relevant.`;
        }

        if (mode === 'HEALTH') {
            return `You are a senior database administrator (DBA) specializing in database health and performance.
Analyze the provided health report data and give actionable recommendations.
Use only the supplied metrics and context. Do not invent data.
Be specific about commands, configuration changes, and expected impact.
Return concise markdown with clear sections and short bullets.
Prioritize production safety in all recommendations.`;
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

    static getTemperature(mode = "GEN") {
        if (mode === 'GEN' || mode === 'IMPACT' || mode === 'QUALITY' || mode === 'HEALTH') {
            return 0.1;
        }
        return 0.3;
    }

    static isImpactAnalysisLikelyIncomplete(text = '') {
        const raw = String(text || '').trim();
        if (raw.length < 120) {
            return true;
        }

        const normalized = raw.replace(/\r\n/g, '\n');
        const lower = normalized.toLowerCase();
        const requiredHeadings = [
            '### risk summary',
            '### likely failures',
            '### mitigation plan',
            '### validation checklist'
        ];

        if (requiredHeadings.some((heading) => !lower.includes(heading))) {
            return true;
        }

        const hasChecklistItem = /###\s*validation checklist[\s\S]*?(?:\n\s*[-*]|\n\s*\d+\.)/i.test(normalized);
        if (!hasChecklistItem) {
            return true;
        }

        if (/:\s*(openai|gemini|anthropic|deepseek|groq|mistral|local(?:\s*ai)?)\s*$/i.test(normalized)) {
            return true;
        }

        if (/(openai|gemini|anthropic|deepseek|groq|mistral|local(?:\s*ai)?)\s*$/i.test(normalized)) {
            const lastLine = normalized.split('\n').pop()?.trim().toLowerCase() || '';
            if (['openai', 'gemini', 'anthropic', 'deepseek', 'groq', 'mistral', 'local', 'local ai'].includes(lastLine)) {
                return true;
            }
        }

        if (/[:;,]$/.test(normalized)) {
            return true;
        }

        return false;
    }

    static isQualityAnalysisLikelyIncomplete(text = '') {
        const raw = String(text || '').trim();
        if (raw.length < 120) {
            return true;
        }

        const normalized = raw.replace(/\r\n/g, '\n').toLowerCase();
        const requiredHeadings = [
            '### quality risk summary',
            '### root cause analysis',
            '### remediation plan',
            '### validation queries'
        ];

        if (requiredHeadings.some((heading) => !normalized.includes(heading))) {
            return true;
        }

        const hasListItem = /###\s*validation queries[\s\S]*?(?:\n\s*[-*]|\n\s*\d+\.)/i.test(raw);
        if (!hasListItem) {
            return true;
        }

        if (/[:;,]$/.test(raw)) {
            return true;
        }

        return false;
    }

    static buildSchemaImpactContext(impactInput = {}) {
        const connection = impactInput.connection || {};
        const diff = impactInput.diff || {};
        const breakingChanges = Array.isArray(impactInput.breakingChanges) ? impactInput.breakingChanges : [];
        const impactWarnings = Array.isArray(impactInput.impactWarnings) ? impactInput.impactWarnings : [];

        const newTables = Array.isArray(diff.new_tables) ? diff.new_tables : (Array.isArray(diff.newTables) ? diff.newTables : []);
        const droppedTables = Array.isArray(diff.dropped_tables) ? diff.dropped_tables : (Array.isArray(diff.droppedTables) ? diff.droppedTables : []);
        const modifiedTables = Array.isArray(diff.modified_tables) ? diff.modified_tables : (Array.isArray(diff.modifiedTables) ? diff.modifiedTables : []);

        const lines = [
            `Database Type: ${(connection.dbType || connection.db_type || 'unknown').toString()}`,
            `Connection Name: ${(connection.name || 'unknown').toString()}`,
            `Schema Changes: +${newTables.length} new tables, -${droppedTables.length} dropped tables, ~${modifiedTables.length} modified tables`,
        ];

        if (newTables.length > 0) {
            lines.push('New Tables:');
            newTables.slice(0, 10).forEach((table) => {
                const name = table?.name || 'unknown_table';
                const cols = Array.isArray(table?.columns) ? table.columns.length : 0;
                lines.push(`- ${name} (${cols} columns)`);
            });
        }

        if (droppedTables.length > 0) {
            lines.push('Dropped Tables:');
            droppedTables.slice(0, 10).forEach((table) => {
                const name = table?.name || 'unknown_table';
                const cols = Array.isArray(table?.columns) ? table.columns.length : 0;
                lines.push(`- ${name} (${cols} columns removed)`);
            });
        }

        if (modifiedTables.length > 0) {
            lines.push('Modified Tables:');
            modifiedTables.slice(0, 15).forEach((tableDiff) => {
                const tableName = tableDiff?.table_name || tableDiff?.tableName || 'unknown_table';
                const newCols = Array.isArray(tableDiff?.new_columns) ? tableDiff.new_columns : (Array.isArray(tableDiff?.newColumns) ? tableDiff.newColumns : []);
                const droppedCols = Array.isArray(tableDiff?.dropped_columns) ? tableDiff.dropped_columns : (Array.isArray(tableDiff?.droppedColumns) ? tableDiff.droppedColumns : []);
                const modifiedCols = Array.isArray(tableDiff?.modified_columns) ? tableDiff.modified_columns : (Array.isArray(tableDiff?.modifiedColumns) ? tableDiff.modifiedColumns : []);
                const newIndexes = Array.isArray(tableDiff?.new_indexes) ? tableDiff.new_indexes : (Array.isArray(tableDiff?.newIndexes) ? tableDiff.newIndexes : []);
                const droppedIndexes = Array.isArray(tableDiff?.dropped_indexes) ? tableDiff.dropped_indexes : (Array.isArray(tableDiff?.droppedIndexes) ? tableDiff.droppedIndexes : []);

                lines.push(`- ${tableName}: +${newCols.length} cols, -${droppedCols.length} cols, ~${modifiedCols.length} cols, +${newIndexes.length} idx, -${droppedIndexes.length} idx`);

                droppedCols.slice(0, 6).forEach((col) => {
                    lines.push(`  - dropped column: ${col?.name || 'unknown_column'}`);
                });

                modifiedCols.slice(0, 6).forEach((colDiff) => {
                    const columnName = colDiff?.column_name || colDiff?.columnName || 'unknown_column';
                    const changes = Array.isArray(colDiff?.changes) ? colDiff.changes : [];
                    const changeSummary = changes.map((change) => this.summarizeColumnChange(change)).join('; ');
                    lines.push(`  - changed column: ${columnName}${changeSummary ? ` (${changeSummary})` : ''}`);
                });
            });
        }

        if (impactWarnings.length > 0) {
            lines.push('Rule-Based Impact Warnings:');
            impactWarnings.slice(0, 20).forEach((warning) => {
                lines.push(`- [${warning?.severity || 'Unknown'}] ${warning?.message || 'No warning message'}`);
            });
        }

        if (breakingChanges.length > 0) {
            lines.push('Detected Breaking Changes:');
            breakingChanges.slice(0, 20).forEach((change) => {
                lines.push(`- [${change?.change_type || change?.changeType || 'Unknown'}] ${change?.description || 'No description'}`);
            });
        }

        return lines.join('\n').trim();
    }

    static buildQualityContext(qualityInput = {}) {
        const report = qualityInput.report || {};
        const connection = qualityInput.connection || {};
        const trends = Array.isArray(qualityInput.trends) ? qualityInput.trends : [];
        const issues = Array.isArray(report.issues) ? report.issues : [];
        const columnMetrics = Array.isArray(report.column_metrics) ? report.column_metrics : [];

        const lines = [
            `Database Type: ${(connection.dbType || connection.db_type || 'unknown').toString()}`,
            `Connection Name: ${(connection.name || 'unknown').toString()}`,
            `Schema/Database: ${(qualityInput.database || report.schema_name || connection.database || connection.schema || 'unknown').toString()}`,
            `Table: ${(qualityInput.table || report.table_name || 'unknown_table').toString()}`,
            `Overall Score: ${Number(report.overall_score ?? 0).toFixed(2)} / 100`,
            `Row Count: ${Number(report.row_count ?? 0)}`,
            `Issue Count: ${issues.length}`,
        ];

        if (issues.length > 0) {
            lines.push('Detected Issues:');
            issues.slice(0, 25).forEach((issue) => {
                const severity = this.readIssueSeverity(issue?.severity);
                const type = this.readIssueType(issue?.issue_type);
                const affected = issue?.affected_row_count ?? issue?.affectedRowCount;
                const col = issue?.column_name || issue?.columnName;
                let detail = `- [${severity}] ${type}: ${issue?.description || 'No description'}`;
                if (col) detail += ` | column: ${col}`;
                if (typeof affected === 'number') detail += ` | affected_rows: ${affected}`;
                lines.push(detail);
            });
        } else {
            lines.push('Detected Issues: none');
        }

        if (columnMetrics.length > 0) {
            lines.push('Column Quality Metrics:');
            columnMetrics.slice(0, 40).forEach((metric) => {
                const nullPct = Number(metric?.null_percentage ?? 0).toFixed(2);
                const distinctPct = Number(metric?.distinct_percentage ?? 0).toFixed(2);
                const min = metric?.min_value ?? '-';
                const max = metric?.max_value ?? '-';
                lines.push(`- ${metric?.column_name || 'unknown_column'}: null=${nullPct}%, distinct=${distinctPct}%, min=${min}, max=${max}`);
            });
        }

        if (trends.length > 1) {
            const recent = [...trends]
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                .slice(-8);
            lines.push('Recent Trend Scores:');
            recent.forEach((entry) => {
                const ts = entry?.timestamp ? new Date(entry.timestamp).toISOString() : 'unknown_time';
                const score = Number(entry?.overall_score ?? 0).toFixed(2);
                lines.push(`- ${ts}: ${score}`);
            });
        }

        return lines.join('\n').trim();
    }

    static summarizeColumnChange(change) {
        if (!change || typeof change !== 'object') {
            return 'column definition updated';
        }

        const typeChange = change.type_changed || change.TypeChanged;
        if (typeChange && typeof typeChange === 'object') {
            return `type ${typeChange.old || '?'} -> ${typeChange.new || '?'}`;
        }

        const nullableChange = change.nullable_changed || change.NullableChanged;
        if (nullableChange && typeof nullableChange === 'object') {
            return `nullable ${nullableChange.old} -> ${nullableChange.new}`;
        }

        const defaultChange = change.default_changed || change.DefaultChanged;
        if (defaultChange && typeof defaultChange === 'object') {
            return `default ${defaultChange.old ?? 'NULL'} -> ${defaultChange.new ?? 'NULL'}`;
        }

        if (Object.prototype.hasOwnProperty.call(change, 'key_changed') || Object.prototype.hasOwnProperty.call(change, 'KeyChanged')) {
            return 'key/index flag updated';
        }

        const other = change.other || change.Other;
        if (typeof other === 'string' && other.trim()) {
            return other;
        }

        return 'column definition updated';
    }

    static readIssueType(issueType) {
        if (typeof issueType === 'string') {
            return issueType;
        }

        if (issueType && typeof issueType === 'object') {
            const entries = Object.entries(issueType);
            if (entries.length > 0) {
                const [key, value] = entries[0];
                if (key === 'Other' && value) return `Other(${value})`;
                return key;
            }
        }

        return 'UnknownIssue';
    }

    static readIssueSeverity(severity) {
        if (typeof severity === 'string') {
            return severity;
        }

        if (severity && typeof severity === 'object') {
            const entries = Object.keys(severity);
            if (entries.length > 0) {
                return entries[0];
            }
        }

        return 'Unknown';
    }

    static async analyzeHealthReport(provider, apiKey, model, healthInput = {}) {
        const context = this.buildHealthContext(healthInput);
        const prompt = `
Analyze this database health report and provide actionable insights.

Return concise markdown in this structure:

## Executive Summary
2-3 sentences summarizing overall health status and trend.

## Top 3 Priority Actions
List the most critical actions to take, with specific commands when applicable.
Format: **Action Name**: Brief description
- Recommended command: SQL or config change
- Expected impact: Quantified improvement

## Risk Assessment
- **Data Loss Risk**: LOW/MEDIUM/HIGH - reason
- **Performance Risk**: LOW/MEDIUM/HIGH - reason  
- **Security Risk**: LOW/MEDIUM/HIGH - reason

## Recommended Timeline
- **Immediate** (today): ...
- **This Week**: ...
- **Ongoing**: ...

Keep recommendations specific to the provided metrics and database type.
`;

        const response = await this.generateResponse(provider, apiKey, model, prompt, "HEALTH", context);
        return response;
    }

    static async explainMetric(provider, apiKey, model, metricInput = {}) {
        const context = this.buildMetricContext(metricInput);
        const prompt = `
Explain this database metric in plain language for a DBA or developer.

1. What does this metric measure? (1-2 sentences)
2. Why is the current value a concern? (if status is warning/critical)
3. What are common causes for this issue?
4. What are the recommended fixes?

Keep the explanation concise (max 150 words) and actionable.
Use markdown formatting with short bullets.
`;

        const response = await this.generateResponse(provider, apiKey, model, prompt, "EXPLAIN", context);
        return response;
    }

    static async generateFixRecommendation(provider, apiKey, model, recInput = {}) {
        const context = this.buildRecommendationContext(recInput);
        const prompt = `
Generate a detailed fix guide for this database health recommendation.

Provide:
1. **Step-by-Step Fix Instructions** - numbered list of exact steps
2. **Pre-flight Checks** - what to verify before applying the fix
3. **Rollback Plan** - how to undo if something goes wrong
4. **Verification Query** - SQL to confirm the fix worked
5. **Post-fix Monitoring** - what to watch after applying

Use markdown formatting. Include actual SQL commands where applicable.
Keep it production-safe with clear warnings for destructive operations.
`;

        const response = await this.generateResponse(provider, apiKey, model, prompt, "FIX", context);
        return response;
    }

    static async answerHealthQuestion(provider, apiKey, model, question, healthInput = {}) {
        const context = this.buildHealthContext(healthInput);
        const prompt = `
Answer this question about the database health report:

"${question}"

Base your answer ONLY on the provided health data. Be specific and actionable.
If the question cannot be answered from the available data, say so.
Use markdown formatting. Keep response under 200 words.
`;

        const response = await this.generateResponse(provider, apiKey, model, prompt, "HEALTH", context);
        return response;
    }

    static buildHealthContext(healthInput = {}) {
        const report = healthInput.healthReport || {};
        const connection = healthInput.connection || {};
        const categories = Array.isArray(report.categories) ? report.categories : [];
        const previousScores = Array.isArray(report.previous_scores) ? report.previous_scores : [];

        const lines = [
            `Database Type: ${(connection.dbType || connection.db_type || 'unknown').toString()}`,
            `Connection Name: ${(connection.name || 'unknown').toString()}`,
            `Overall Score: ${report.overall_score ?? 0} (Grade: ${report.grade || 'N/A'})`,
            `Trend: ${report.trend || 'unknown'}`,
            `Critical Issues: ${report.critical_issues ?? 0}`,
            `Warnings: ${report.warnings ?? 0}`,
            `Last Updated: ${report.last_updated || 'unknown'}`,
            ''
        ];

        lines.push('=== CATEGORY DETAILS ===');
        categories.forEach(cat => {
            lines.push(`\n[${cat.name}] Score: ${cat.score} (${cat.status})`);
            if (Array.isArray(cat.metrics)) {
                cat.metrics.forEach(m => {
                    if (m.status !== 'healthy') {
                        lines.push(`  - ${m.label}: ${m.value} (${m.status})`);
                        if (m.description) {
                            lines.push(`    ${m.description}`);
                        }
                    }
                });
            }
        });

        if (previousScores.length > 0) {
            lines.push('\n=== SCORE HISTORY (last 7 days) ===');
            previousScores.slice(0, 7).forEach(s => {
                lines.push(`- ${s.date || 'unknown'}: ${s.score} (${s.grade})`);
            });
        }

        const recommendations = healthInput.recommendations || [];
        if (recommendations.length > 0) {
            lines.push('\n=== RECOMMENDATIONS ===');
            recommendations.slice(0, 10).forEach(rec => {
                lines.push(`- [${rec.severity}] ${rec.title}: ${rec.description}`);
                if (rec.action_sql) {
                    lines.push(`  SQL: ${rec.action_sql}`);
                }
            });
        }

        return lines.join('\n').trim();
    }

    static buildMetricContext(metricInput = {}) {
        const metric = metricInput.metric || {};
        const dbType = metricInput.dbType || 'unknown';

        const lines = [
            `Database Type: ${dbType}`,
            '',
            '=== METRIC DETAILS ===',
            `ID: ${metric.id || 'unknown'}`,
            `Label: ${metric.label || 'unknown'}`,
            `Current Value: ${metric.value || 'unknown'}`,
            `Raw Value: ${metric.raw_value ?? 'N/A'}`,
            `Status: ${metric.status || 'unknown'}`,
            `Weight: ${metric.weight ?? 'N/A'}`,
            `Warning Threshold: ${metric.threshold_warning ?? 'N/A'}`,
            `Critical Threshold: ${metric.threshold_critical ?? 'N/A'}`,
        ];

        if (metric.description) {
            lines.push(`Description: ${metric.description}`);
        }

        if (metric.unit) {
            lines.push(`Unit: ${metric.unit}`);
        }

        return lines.join('\n').trim();
    }

    static buildRecommendationContext(recInput = {}) {
        const recommendation = recInput.recommendation || {};
        const healthReport = recInput.healthReport || {};
        const dbType = recInput.dbType || 'unknown';

        const lines = [
            `Database Type: ${dbType}`,
            `Current Health Score: ${healthReport.overall_score ?? 'N/A'}`,
            '',
            '=== RECOMMENDATION ===',
            `ID: ${recommendation.id || 'unknown'}`,
            `Category: ${recommendation.category || 'unknown'}`,
            `Severity: ${recommendation.severity || 'unknown'}`,
            `Title: ${recommendation.title || 'unknown'}`,
            `Description: ${recommendation.description || 'No description'}`,
            `Impact: ${recommendation.impact || 'Unknown impact'}`,
            `Effort: ${recommendation.effort || 'Unknown effort'}`,
            `Action Type: ${recommendation.action_type || 'unknown'}`,
        ];

        if (recommendation.action_sql) {
            lines.push(`Suggested SQL: ${recommendation.action_sql}`);
        }

        if (recommendation.documentation_url) {
            lines.push(`Documentation: ${recommendation.documentation_url}`);
        }

        if (Array.isArray(recommendation.related_metrics)) {
            lines.push(`Related Metrics: ${recommendation.related_metrics.join(', ')}`);
        }

        return lines.join('\n').trim();
    }
}

