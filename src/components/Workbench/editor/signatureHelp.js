/**
 * Signature Help Module
 * 
 * Provides function signature tooltips when typing function calls
 * Shows current parameter being typed and available overloads
 */

import { FUNCTION_SIGNATURES } from './quickInfo.js';
import { getActiveDbType } from '../../../database/index.js';

const POSTGRES_SPECIFIC = {
    TO_DATE: { signatures: [{ params: ['text', 'format'], returns: 'DATE', description: 'Convert string to date' }] },
    TO_TIMESTAMP: { signatures: [{ params: ['text', 'format'], returns: 'TIMESTAMP', description: 'Convert string to timestamp' }] },
    EXTRACT: { signatures: [{ params: ['field FROM timestamp'], returns: 'INT', description: 'Extract date/time field' }] },
    AGE: { signatures: [{ params: ['timestamp'], returns: 'INTERVAL', description: 'Age from now' }, { params: ['timestamp', 'timestamp'], returns: 'INTERVAL', description: 'Age between timestamps' }] },
    GENERATE_SERIES: { signatures: [{ params: ['start', 'end'], returns: 'SETOF', description: 'Generate series of values' }, { params: ['start', 'end', 'step'], returns: 'SETOF', description: 'Generate series with step' }] },
    STRING_AGG: { signatures: [{ params: ['expression', 'delimiter'], returns: 'TEXT', description: 'Aggregate strings with delimiter' }] },
    ARRAY_AGG: { signatures: [{ params: ['expression'], returns: 'ARRAY', description: 'Aggregate into array' }] },
    JSONB_BUILD_OBJECT: { signatures: [{ params: ['key', 'value', '...'], returns: 'JSONB', description: 'Build JSON object' }] },
    REGEXP_MATCHES: { signatures: [{ params: ['string', 'pattern'], returns: 'TEXT[]', description: 'Match regex pattern' }] },
};

const MYSQL_SPECIFIC = {
    GROUP_CONCAT: { signatures: [{ params: ['expression'], returns: 'VARCHAR', description: 'Concatenate values from group' }, { params: ['DISTINCT expression'], returns: 'VARCHAR', description: 'Concatenate unique values' }] },
    DATE_FORMAT: { signatures: [{ params: ['date', 'format'], returns: 'VARCHAR', description: 'Format date as string' }] },
    STR_TO_DATE: { signatures: [{ params: ['string', 'format'], returns: 'DATE', description: 'Parse string to date' }] },
    FIND_IN_SET: { signatures: [{ params: ['string', 'stringlist'], returns: 'INT', description: 'Find string in comma list' }] },
    ELT: { signatures: [{ params: ['index', 'str1', 'str2', '...'], returns: 'VARCHAR', description: 'Return string at index' }] },
    FIELD: { signatures: [{ params: ['str', 'str1', 'str2', '...'], returns: 'INT', description: 'Return index of string' }] },
    JSON_EXTRACT: { signatures: [{ params: ['json_doc', 'path'], returns: 'JSON', description: 'Extract value from JSON' }] },
    JSON_UNQUOTE: { signatures: [{ params: ['json_val'], returns: 'VARCHAR', description: 'Unquote JSON value' }] },
    INET_ATON: { signatures: [{ params: ['ip_string'], returns: 'INT', description: 'Convert IP to number' }] },
    INET_NTOA: { signatures: [{ params: ['ip_number'], returns: 'VARCHAR', description: 'Convert number to IP' }] },
};

const DEFAULT_SIGNATURES = {
    ...Object.fromEntries(
        Object.entries(FUNCTION_SIGNATURES).map(([name, info]) => [
            name, 
            { signatures: [{ params: info.signature.replace(/[()]/g, '').split(',').map(p => p.trim()), returns: info.returns, description: info.description }] }
        ]
    ),
    ...MYSQL_SPECIFIC,
    ...POSTGRES_SPECIFIC,
};

function findFunctionCall(query, cursorPos) {
    const beforeCursor = query.substring(0, cursorPos);
    const afterCursor = query.substring(cursorPos);
    
    let parenDepth = 0;
    let funcStart = -1;
    let funcName = '';
    
    for (let i = beforeCursor.length - 1; i >= 0; i--) {
        const char = beforeCursor[i];
        
        if (char === ')') {
            parenDepth++;
        } else if (char === '(') {
            parenDepth--;
            if (parenDepth < 0) {
                funcStart = i;
                break;
            }
        } else if (parenDepth === -1 && /[a-zA-Z0-9_]/.test(char)) {
        } else if (parenDepth === -1 && !/[a-zA-Z0-9_]/.test(char)) {
            break;
        }
    }
    
    if (funcStart === -1) return null;
    
    const funcMatch = beforeCursor.substring(0, funcStart).match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*$/);
    if (!funcMatch) return null;
    
    funcName = funcMatch[1].toUpperCase();
    
    const argsStart = funcStart + 1;
    const argsPart = beforeCursor.substring(argsStart) + afterCursor.split(')')[0];
    
    let currentParenDepth = 0;
    let argStart = 0;
    let currentArgIndex = 0;
    
    for (let i = 0; i < beforeCursor.length - argsStart; i++) {
        const char = argsPart[i];
        if (char === '(') currentParenDepth++;
        else if (char === ')') currentParenDepth--;
        else if (char === ',' && currentParenDepth === 0) {
            currentArgIndex++;
        }
    }
    
    return {
        functionName: funcName,
        argumentIndex: currentArgIndex,
        argumentsText: argsPart,
        startOffset: funcStart - funcName.length,
        endOffset: cursorPos,
    };
}

function getParameterName(params, index) {
    if (index >= params.length) {
        if (params[params.length - 1]?.includes('...')) {
            return params[params.length - 1].replace('...', '').trim() + (index - params.length + 2);
        }
        return `param${index + 1}`;
    }
    return params[index];
}

class SignatureHelpService {
    #cache = new Map();
    
    getSignatureHelp(query, cursorPos) {
        const callInfo = findFunctionCall(query, cursorPos);
        
        if (!callInfo) return null;
        
        const { functionName, argumentIndex } = callInfo;
        const funcData = DEFAULT_SIGNATURES[functionName];
        
        if (!funcData) {
            const builtIn = FUNCTION_SIGNATURES[functionName];
            if (!builtIn) return null;
            
            return {
                functionName,
                signatures: [{
                    label: `${functionName}(${builtIn.signature})`,
                    parameters: builtIn.signature.split(',').map(p => ({ label: p.trim() })),
                    activeParameter: Math.min(argumentIndex, builtIn.signature.split(',').length - 1),
                }],
                returnInfo: builtIn,
            };
        }
        
        const signatures = funcData.signatures.map(sig => ({
            label: `${functionName}(${sig.params.join(', ')})`,
            parameters: sig.params.map(p => ({ label: p })),
            returns: sig.returns,
            description: sig.description,
        }));
        
        const activeSig = signatures[0];
        const activeParam = Math.min(argumentIndex, activeSig.parameters.length - 1);
        
        return {
            functionName,
            signatures,
            activeSignature: 0,
            activeParameter: activeParam >= 0 ? activeParam : 0,
            currentParamName: getParameterName(activeSig.parameters.map(p => p.label), argumentIndex),
            returnInfo: {
                returns: activeSig.returns,
                description: activeSig.description,
            },
        };
    }
    
    getAllSignatures(functionName) {
        return DEFAULT_SIGNATURES[functionName.toUpperCase()] || null;
    }
    
    formatSignatureForDisplay(sigHelp) {
        if (!sigHelp) return null;
        
        const { functionName, signatures, activeSignature, activeParameter } = sigHelp;
        const sig = signatures[activeSignature];
        
        const parts = sig.parameters.map((param, idx) => {
            const isActive = idx === activeParameter;
            const label = param.label;
            return isActive ? `**${label}**` : label;
        });
        
        return {
            title: functionName,
            signature: `${functionName}(${parts.join(', ')})`,
            returns: sig.returns,
            description: sig.description,
            activeParam: sig.parameters[activeParameter]?.label,
        };
    }
}

export const signatureHelpService = new SignatureHelpService();
export { findFunctionCall, DEFAULT_SIGNATURES };
