/**
 * Autocomplete Module Index
 * Re-exports all autocomplete submodules for easy imports
 */

export { 
    getAllBuiltinSnippets, 
    findSnippets,
    SELECT_SNIPPETS,
    JOIN_SNIPPETS,
    INSERT_SNIPPETS,
    UPDATE_SNIPPETS,
    DELETE_SNIPPETS,
    CTE_SNIPPETS,
    AGGREGATION_SNIPPETS,
    WINDOW_SNIPPETS,
    DDL_SNIPPETS,
    POSTGRESQL_SNIPPETS,
} from './snippets.js';

export {
    MYSQL_FUNCTIONS,
    POSTGRESQL_FUNCTIONS,
    getFunctionsForDb,
    getAllFunctionNames,
    searchFunctions,
} from './functions.js';

export {
    CONTEXT,
    TYPE_OPERATORS,
    isKeyword,
    detectQueryType,
    parseCTEs,
    parseTableReferences,
    parseQuery,
    detectContext,
    getCurrentWord,
    isAfterDot,
    getWordBeforeDot,
    getPreviousWord,
} from './parser.js';
