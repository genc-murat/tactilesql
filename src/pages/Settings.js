import { ThemeManager } from '../utils/ThemeManager.js';
import { SettingsManager } from '../utils/SettingsManager.js';

// Snippet categories and descriptions
const SNIPPET_HELP = {
    'SELECT Queries': [
        { trigger: 'sel', description: 'Basic SELECT query with WHERE' },
        { trigger: 'selc', description: 'Select specific columns' },
        { trigger: 'sela', description: 'Select all records (SELECT *)' },
        { trigger: 'seld', description: 'DISTINCT - unique values only' },
        { trigger: 'selt', description: 'Get first N records (LIMIT)' },
        { trigger: 'selcount', description: 'Get record count' },
    ],
    'JOIN Queries': [
        { trigger: 'selj', description: 'INNER JOIN query' },
        { trigger: 'sellj', description: 'LEFT JOIN query' },
        { trigger: 'selrj', description: 'RIGHT JOIN query' },
        { trigger: 'selfj', description: 'FULL OUTER JOIN (MySQL compatible)' },
        { trigger: 'selcj', description: 'CROSS JOIN - cartesian product' },
        { trigger: 'selsj', description: 'Self JOIN - table with itself' },
        { trigger: 'jmulti', description: 'Multiple JOIN query' },
    ],
    'INSERT / UPDATE / DELETE': [
        { trigger: 'ins', description: 'Insert single row' },
        { trigger: 'insm', description: 'Insert multiple rows' },
        { trigger: 'inss', description: 'INSERT from SELECT' },
        { trigger: 'insig', description: 'INSERT IGNORE - skip errors' },
        { trigger: 'insdup', description: 'ON DUPLICATE KEY UPDATE' },
        { trigger: 'replace', description: 'REPLACE INTO' },
        { trigger: 'upd', description: 'Basic UPDATE' },
        { trigger: 'updm', description: 'Update multiple columns' },
        { trigger: 'updj', description: 'UPDATE with JOIN' },
        { trigger: 'updcase', description: 'UPDATE with CASE' },
        { trigger: 'updinc', description: 'Increment value' },
        { trigger: 'del', description: 'Basic DELETE' },
        { trigger: 'delj', description: 'DELETE with JOIN' },
        { trigger: 'dellim', description: 'DELETE with LIMIT' },
        { trigger: 'trunc', description: 'TRUNCATE - delete all data' },
    ],
    'CTE (Common Table Expression)': [
        { trigger: 'cte', description: 'Basic CTE query' },
        { trigger: 'ctm', description: 'Multiple CTEs' },
        { trigger: 'cterec', description: 'Recursive CTE - hierarchical data' },
        { trigger: 'hier', description: 'Hierarchy query (tree structure)' },
    ],
    'Subqueries': [
        { trigger: 'sub', description: 'Subquery in FROM clause' },
        { trigger: 'subin', description: 'Subquery with IN' },
        { trigger: 'subnotin', description: 'Subquery with NOT IN' },
        { trigger: 'subsel', description: 'Scalar subquery in SELECT' },
        { trigger: 'exist', description: 'EXISTS check' },
        { trigger: 'notex', description: 'NOT EXISTS check' },
        { trigger: 'corr', description: 'Correlated subquery' },
    ],
    'CASE & NULL': [
        { trigger: 'case', description: 'Basic CASE WHEN' },
        { trigger: 'casem', description: 'Multi-condition CASE' },
        { trigger: 'cases', description: 'Simple CASE expression' },
        { trigger: 'casesel', description: 'CASE in SELECT clause' },
        { trigger: 'ifnull', description: 'Default value if NULL' },
        { trigger: 'coal', description: 'COALESCE - first non-null' },
        { trigger: 'nullif', description: 'NULLIF function' },
        { trigger: 'isnull', description: 'Find NULL records' },
        { trigger: 'isnotnull', description: 'Find non-NULL records' },
    ],
    'Aggregation': [
        { trigger: 'count', description: 'COUNT with grouping' },
        { trigger: 'sum', description: 'SUM total' },
        { trigger: 'avg', description: 'AVG average' },
        { trigger: 'minmax', description: 'MIN and MAX values' },
        { trigger: 'stats', description: 'Statistical summary' },
        { trigger: 'groupc', description: 'GROUP_CONCAT' },
        { trigger: 'having', description: 'HAVING clause' },
        { trigger: 'rollup', description: 'ROLLUP - subtotals' },
    ],
    'Window Functions': [
        { trigger: 'rank', description: 'ROW_NUMBER ranking' },
        { trigger: 'rownum', description: 'Row numbering' },
        { trigger: 'denserank', description: 'DENSE_RANK' },
        { trigger: 'ntile', description: 'NTILE - equal partitions' },
        { trigger: 'lag', description: 'LAG - previous row value' },
        { trigger: 'lead', description: 'LEAD - next row value' },
        { trigger: 'sumover', description: 'Cumulative sum' },
        { trigger: 'avgover', description: 'Moving average' },
        { trigger: 'firstval', description: 'First value in partition' },
        { trigger: 'lastval', description: 'Last value in partition' },
        { trigger: 'pctrank', description: 'Percentile ranking' },
    ],
    'Set Operations': [
        { trigger: 'union', description: 'UNION - combine unique' },
        { trigger: 'unionall', description: 'UNION ALL - combine all' },
        { trigger: 'intersect', description: 'INTERSECT - common records' },
        { trigger: 'except', description: 'EXCEPT - difference' },
    ],
    'Date Operations': [
        { trigger: 'today', description: 'Today\'s records' },
        { trigger: 'yesterday', description: 'Yesterday\'s records' },
        { trigger: 'thisweek', description: 'This week\'s records' },
        { trigger: 'thismonth', description: 'This month\'s records' },
        { trigger: 'lastmonth', description: 'Last month\'s records' },
        { trigger: 'thisyear', description: 'This year\'s records' },
        { trigger: 'lastn', description: 'Last N days records' },
        { trigger: 'daterange', description: 'Date range filter' },
        { trigger: 'bymonth', description: 'Group by month' },
        { trigger: 'byweek', description: 'Group by week' },
        { trigger: 'byday', description: 'Group by day' },
        { trigger: 'byhour', description: 'Group by hour' },
        { trigger: 'datediff', description: 'Calculate date difference' },
    ],
    'Data Analysis': [
        { trigger: 'dup', description: 'Find duplicate records' },
        { trigger: 'topn', description: 'Top N per group' },
        { trigger: 'pivot', description: 'Pivot table query' },
        { trigger: 'unpivot', description: 'Unpivot - columns to rows' },
        { trigger: 'growth', description: 'Growth percentage calculation' },
        { trigger: 'cumsum', description: 'Cumulative sum' },
        { trigger: 'yoy', description: 'Year over year comparison' },
    ],
    'String & JSON': [
        { trigger: 'concat', description: 'String concatenation' },
        { trigger: 'substr', description: 'Extract substring' },
        { trigger: 'trim', description: 'Trim whitespace' },
        { trigger: 'repl', description: 'String replacement' },
        { trigger: 'like', description: 'LIKE pattern search' },
        { trigger: 'regexp', description: 'Regex search' },
        { trigger: 'split', description: 'Split string' },
        { trigger: 'jsonext', description: 'JSON value extraction' },
        { trigger: 'jsonunq', description: 'JSON unquote' },
        { trigger: 'jsonarr', description: 'JSON array access' },
        { trigger: 'jsonset', description: 'JSON value update' },
        { trigger: 'jsonobj', description: 'Create JSON object' },
        { trigger: 'jsontable', description: 'JSON to table rows' },
    ],
    'Pagination': [
        { trigger: 'pag', description: 'Basic pagination (LIMIT/OFFSET)' },
        { trigger: 'pagcursor', description: 'Cursor-based pagination' },
        { trigger: 'paginfo', description: 'Pagination with total count' },
    ],
    'DDL - Create': [
        { trigger: 'ct', description: 'CREATE TABLE' },
        { trigger: 'ctlike', description: 'Create table like existing' },
        { trigger: 'ctas', description: 'Create table from SELECT' },
        { trigger: 'cttemp', description: 'Create temporary table' },
        { trigger: 'cv', description: 'CREATE VIEW' },
        { trigger: 'ci', description: 'CREATE INDEX' },
        { trigger: 'ciu', description: 'Create UNIQUE INDEX' },
        { trigger: 'cic', description: 'Composite INDEX' },
        { trigger: 'cift', description: 'FULLTEXT INDEX' },
    ],
    'DDL - Alter': [
        { trigger: 'addcol', description: 'Add column' },
        { trigger: 'dropcol', description: 'Drop column' },
        { trigger: 'modcol', description: 'Modify column' },
        { trigger: 'rencol', description: 'Rename column' },
        { trigger: 'rentab', description: 'Rename table' },
        { trigger: 'addfk', description: 'Add foreign key' },
        { trigger: 'dropfk', description: 'Drop foreign key' },
        { trigger: 'addpk', description: 'Add primary key' },
        { trigger: 'droppk', description: 'Drop primary key' },
        { trigger: 'adduniq', description: 'Add UNIQUE constraint' },
        { trigger: 'addidx', description: 'Add index' },
        { trigger: 'dropidx', description: 'Drop index' },
        { trigger: 'adddef', description: 'Add default value' },
        { trigger: 'dropdef', description: 'Drop default value' },
    ],
    'Procedures & Triggers': [
        { trigger: 'proc', description: 'Create stored procedure' },
        { trigger: 'func', description: 'Create function' },
        { trigger: 'callproc', description: 'Call procedure' },
        { trigger: 'trig', description: 'Create trigger' },
        { trigger: 'trigaudit', description: 'Audit trigger example' },
    ],
    'Transactions': [
        { trigger: 'trans', description: 'Transaction block' },
        { trigger: 'transsafe', description: 'Transaction with error handling' },
        { trigger: 'savepoint', description: 'Savepoint usage' },
    ],
    'Admin & Utility': [
        { trigger: 'showtab', description: 'List tables' },
        { trigger: 'showdb', description: 'List databases' },
        { trigger: 'showcol', description: 'Show columns' },
        { trigger: 'showfull', description: 'Detailed column info' },
        { trigger: 'showct', description: 'Show CREATE TABLE statement' },
        { trigger: 'showidx', description: 'Show indexes' },
        { trigger: 'showproc', description: 'Show active processes' },
        { trigger: 'desc', description: 'Describe table structure' },
        { trigger: 'explain', description: 'Show query plan' },
        { trigger: 'expana', description: 'EXPLAIN ANALYZE' },
        { trigger: 'analyze', description: 'Analyze table' },
        { trigger: 'optimize', description: 'Optimize table' },
    ],
    'User & Permissions': [
        { trigger: 'createuser', description: 'Create user' },
        { trigger: 'dropuser', description: 'Drop user' },
        { trigger: 'grant', description: 'Grant permissions' },
        { trigger: 'grantall', description: 'Grant all permissions' },
        { trigger: 'revoke', description: 'Revoke permissions' },
        { trigger: 'showgrants', description: 'Show user grants' },
    ],
    'Performance & Debug': [
        { trigger: 'idxhint', description: 'Use index hint' },
        { trigger: 'forceidx', description: 'Force index' },
        { trigger: 'ignoreidx', description: 'Ignore index' },
        { trigger: 'profile', description: 'Profile query' },
        { trigger: 'sample', description: 'Random sample' },
        { trigger: 'tabsize', description: 'Table sizes' },
        { trigger: 'findcol', description: 'Find column by name' },
        { trigger: 'findtab', description: 'Find table by name' },
        { trigger: 'fklist', description: 'List foreign keys' },
    ],
    'Common Patterns': [
        { trigger: 'soft', description: 'Soft delete' },
        { trigger: 'softsel', description: 'Select non-deleted records' },
        { trigger: 'upsert', description: 'Upsert (INSERT or UPDATE)' },
        { trigger: 'merge', description: 'Merge data' },
        { trigger: 'audit', description: 'Audit columns template' },
        { trigger: 'uuid', description: 'UUID column definition' },
    ],
};

export function Settings() {
    let theme = ThemeManager.getCurrentTheme();
    let activeTab = 'general'; // 'general' or 'snippets'
    const container = document.createElement('div');
    const getBgClass = (t) => {
        if (t === 'light') return 'bg-gray-50';
        if (t === 'dawn') return 'bg-[#faf4ed]';
        if (t === 'oceanic') return 'bg-ocean-bg';
        if (t === 'ember') return 'bg-[#140c12]';
        if (t === 'aurora') return 'bg-[#0b1214]';
        return 'bg-base-dark';
    };
    container.className = `h-full overflow-auto ${getBgClass(theme)} transition-colors duration-300`;

    const render = () => {
        const isLight = theme === 'light' || theme === 'dawn';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isEmber = theme === 'ember';
        const isAurora = theme === 'aurora';
        const currentTheme = ThemeManager.getCurrentTheme();
        const snippetSuggestionsEnabled = SettingsManager.get('autocomplete.snippets', true);

        container.innerHTML = `
        <div class="h-full p-6 lg:p-8">
            <!-- Header -->
            <div class="mb-6">
                <h1 class="text-2xl font-bold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">Settings</h1>
                <p class="text-gray-500">Configure your TactileSQL preferences</p>
            </div>

            <!-- Tabs -->
            <div class="flex items-center gap-1 mb-6 p-1 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-black/20'} w-fit">
                <button id="tab-general" class="tab-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'general' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                    <span class="material-symbols-outlined text-lg">settings</span>
                    General
                </button>
                <button id="tab-snippets" class="tab-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'snippets' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                    <span class="material-symbols-outlined text-lg">code_blocks</span>
                    Snippets
                </button>
            </div>

            <!-- Tab Content -->
            <div id="tab-content">
                ${activeTab === 'general' ? renderGeneralTab(isLight, isDawn, isOceanic, isEmber, isAurora, currentTheme, snippetSuggestionsEnabled) : renderSnippetsTab(isLight, isDawn, isOceanic)}
            </div>
        </div>
    `;
    };

    function renderGeneralTab(isLight, isDawn, isOceanic, isEmber, isAurora, currentTheme, snippetSuggestionsEnabled) {
        return `
            <div class="space-y-6">
                <!-- Appearance Section -->
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">palette</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">Appearance</h2>
                            <p class="text-sm text-gray-500">Customize the look and feel</p>
                        </div>
                    </div>

                    <!-- Theme Selection -->
                    <div class="space-y-4">
                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Theme</h3>
                                <p class="text-xs text-gray-500 mt-1">Select your preferred color scheme</p>
                            </div>
                            <div id="theme-toggle" class="flex items-center gap-2 p-1 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-black/20'}">
                                <button id="theme-dark" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'dark' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">dark_mode</span>
                                    Dark
                                </button>
                                <button id="theme-light" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'light' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">light_mode</span>
                                    Light
                                </button>
                                <button id="theme-dawn" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'dawn' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">wb_twilight</span>
                                    Dawn
                                </button>
                                <button id="theme-oceanic" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'oceanic' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">water</span>
                                    Oceanic
                                </button>
                                <button id="theme-ember" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'ember' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">local_fire_department</span>
                                    Ember
                                </button>
                                <button id="theme-aurora" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'aurora' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">flare</span>
                                    Aurora
                                </button>
                            </div>
                        </div>

                        <!-- Theme Preview -->
                        <div class="mt-4">
                            <h4 class="text-xs font-medium ${isLight ? 'text-gray-600' : 'text-gray-400'} uppercase tracking-wider mb-3">Preview</h4>
                            <div id="theme-preview" class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : (isEmber ? 'bg-[#1d141c] border border-[#2c1c27]' : (isAurora ? 'bg-[#0f1a1d] border border-[#1b2e33]' : 'bg-[#13161b] border border-white/10'))))}">
                                ${currentTheme === 'dark' ? getDarkPreview() : (currentTheme === 'light' ? getLightPreview() : (currentTheme === 'dawn' ? getDawnPreview() : (currentTheme === 'oceanic' ? getOceanicPreview() : (currentTheme === 'ember' ? getEmberPreview() : getAuroraPreview()))))}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Editor Section -->
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">code</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">Editor</h2>
                            <p class="text-sm text-gray-500">SQL editor preferences</p>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Font Size</h3>
                                <p class="text-xs text-gray-500 mt-1">Adjust the editor font size</p>
                            </div>
                            <select class="tactile-select w-24 !text-center">
                                <option value="12">12px</option>
                                <option value="14" selected>14px</option>
                                <option value="16">16px</option>
                                <option value="18">18px</option>
                            </select>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Auto-complete</h3>
                                <p class="text-xs text-gray-500 mt-1">Enable SQL auto-completion suggestions</p>
                            </div>
                            <button class="relative w-12 h-6 rounded-full bg-gradient-to-r from-mysql-teal to-mysql-cyan transition-all" title="Coming soon">
                                <span class="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Snippet Suggestions</h3>
                                <p class="text-xs text-gray-500 mt-1">Show snippet triggers in autocomplete</p>
                            </div>
                            <button id="autocomplete-snippets-toggle" class="relative w-12 h-6 rounded-full transition-all ${snippetSuggestionsEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${snippetSuggestionsEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Line Numbers</h3>
                                <p class="text-xs text-gray-500 mt-1">Show line numbers in the editor</p>
                            </div>
                            <button class="relative w-12 h-6 rounded-full bg-gradient-to-r from-mysql-teal to-mysql-cyan transition-all">
                                <span class="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform"></span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- About Section -->
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">info</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">About</h2>
                            <p class="text-sm text-gray-500">Application information</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                            <span class="text-gray-500">Version</span>
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">1.0.0</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                            <span class="text-gray-500">Build</span>
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">2026.01.31</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderSnippetsTab(isLight, isDawn, isOceanic) {
        const categories = Object.keys(SNIPPET_HELP);
        
        return `
            <div class="space-y-6">
                <!-- Info Banner -->
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-start gap-4">
                        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-mysql-teal to-mysql-cyan flex items-center justify-center flex-shrink-0">
                            <span class="material-symbols-outlined text-white text-2xl">tips_and_updates</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">How to Use SQL Snippets</h2>
                            <p class="text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'} mb-3">
                                Type a <code class="px-1.5 py-0.5 rounded ${isLight ? 'bg-gray-100 text-gray-800' : 'bg-white/10 text-gray-200'}">trigger</code> in the SQL Editor and select from the autocomplete list. 
                                The snippet will expand automatically and you can navigate between placeholders using <kbd class="px-1.5 py-0.5 rounded text-xs ${isLight ? 'bg-gray-200 text-gray-700' : 'bg-white/20 text-gray-300'}">Tab</kbd>.
                            </p>
                            <div class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-500' : 'text-gray-500'}">
                                <span class="material-symbols-outlined text-base">lightbulb</span>
                                <span>Example: Type <code class="px-1 py-0.5 rounded ${isLight ? 'bg-amber-50 text-amber-700' : 'bg-amber-500/20 text-amber-400'}">sel</code> → generates a SELECT query</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Search -->
                <div class="relative">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">search</span>
                    <input type="text" id="snippet-search" placeholder="Search snippets..." 
                        class="w-full pl-10 pr-4 py-3 rounded-xl ${isLight ? 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400' : 'bg-black/20 border border-white/10 text-white placeholder-gray-500'} focus:outline-none focus:ring-2 focus:ring-mysql-teal/50">
                </div>

                <!-- Snippet Categories -->
                <div id="snippet-categories" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                    ${categories.map(category => `
                        <div class="snippet-category tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl overflow-hidden" data-category="${category}">
                            <button class="category-toggle w-full flex items-center justify-between p-4 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors">
                                <div class="flex items-center gap-3">
                                    <span class="material-symbols-outlined ${getCategoryIcon(category).color}">${getCategoryIcon(category).icon}</span>
                                    <span class="font-medium ${isLight ? 'text-gray-900' : 'text-white'}">${category}</span>
                                    <span class="text-xs px-2 py-0.5 rounded-full ${isLight ? 'bg-gray-100 text-gray-500' : 'bg-white/10 text-gray-400'}">${SNIPPET_HELP[category].length}</span>
                                </div>
                                <span class="material-symbols-outlined category-chevron text-gray-400 transition-transform">expand_more</span>
                            </button>
                            <div class="category-content hidden border-t ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                <div class="p-3 space-y-1 max-h-64 overflow-y-auto">
                                    ${SNIPPET_HELP[category].map(snippet => `
                                        <div class="snippet-item flex items-center gap-3 px-3 py-2 rounded-lg ${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors" data-trigger="${snippet.trigger}" data-desc="${snippet.description}">
                                            <code class="text-xs font-mono px-2 py-1 rounded ${isLight ? 'bg-mysql-teal/10 text-mysql-teal' : 'bg-mysql-teal/20 text-mysql-cyan'} font-bold min-w-[60px] text-center">${snippet.trigger}</code>
                                            <span class="text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">${snippet.description}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <!-- Stats -->
                <div class="flex items-center justify-center gap-6 py-4 text-sm ${isLight ? 'text-gray-500' : 'text-gray-500'}">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">category</span>
                        <span>${categories.length} categories</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-cyan">code</span>
                        <span>${Object.values(SNIPPET_HELP).reduce((acc, arr) => acc + arr.length, 0)} snippets</span>
                    </div>
                </div>
            </div>
        `;
    }

    function getCategoryIcon(category) {
        const icons = {
            'SELECT Queries': { icon: 'table_view', color: 'text-blue-500' },
            'JOIN Queries': { icon: 'merge', color: 'text-purple-500' },
            'INSERT / UPDATE / DELETE': { icon: 'edit_note', color: 'text-orange-500' },
            'CTE (Common Table Expression)': { icon: 'account_tree', color: 'text-indigo-500' },
            'Subqueries': { icon: 'layers', color: 'text-pink-500' },
            'CASE & NULL': { icon: 'help_center', color: 'text-yellow-500' },
            'Aggregation': { icon: 'functions', color: 'text-green-500' },
            'Window Functions': { icon: 'window', color: 'text-cyan-500' },
            'Set Operations': { icon: 'join', color: 'text-violet-500' },
            'Date Operations': { icon: 'calendar_month', color: 'text-rose-500' },
            'Data Analysis': { icon: 'analytics', color: 'text-emerald-500' },
            'String & JSON': { icon: 'data_object', color: 'text-amber-500' },
            'Pagination': { icon: 'auto_stories', color: 'text-teal-500' },
            'DDL - Create': { icon: 'add_box', color: 'text-lime-500' },
            'DDL - Alter': { icon: 'build', color: 'text-orange-400' },
            'Procedures & Triggers': { icon: 'memory', color: 'text-fuchsia-500' },
            'Transactions': { icon: 'swap_horiz', color: 'text-sky-500' },
            'Admin & Utility': { icon: 'admin_panel_settings', color: 'text-slate-500' },
            'User & Permissions': { icon: 'shield_person', color: 'text-red-500' },
            'Performance & Debug': { icon: 'speed', color: 'text-yellow-600' },
            'Common Patterns': { icon: 'pattern', color: 'text-indigo-400' },
        };
        return icons[category] || { icon: 'code', color: 'text-gray-500' };
    }

    const attachEvents = () => {
        // Tab switching
        const tabGeneral = container.querySelector('#tab-general');
        const tabSnippets = container.querySelector('#tab-snippets');

        tabGeneral?.addEventListener('click', () => {
            if (activeTab !== 'general') {
                activeTab = 'general';
                render();
                attachEvents();
            }
        });

        tabSnippets?.addEventListener('click', () => {
            if (activeTab !== 'snippets') {
                activeTab = 'snippets';
                render();
                attachEvents();
            }
        });

        // Snippet tab events
        if (activeTab === 'snippets') {
            // Category toggles
            const categoryToggles = container.querySelectorAll('.category-toggle');
            categoryToggles.forEach(toggle => {
                toggle.addEventListener('click', () => {
                    const category = toggle.closest('.snippet-category');
                    const content = category.querySelector('.category-content');
                    const chevron = toggle.querySelector('.category-chevron');
                    
                    content.classList.toggle('hidden');
                    chevron.style.transform = content.classList.contains('hidden') ? '' : 'rotate(180deg)';
                });
            });

            // Search
            const searchInput = container.querySelector('#snippet-search');
            searchInput?.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const items = container.querySelectorAll('.snippet-item');
                const categories = container.querySelectorAll('.snippet-category');

                items.forEach(item => {
                    const trigger = item.dataset.trigger.toLowerCase();
                    const desc = item.dataset.desc.toLowerCase();
                    const matches = trigger.includes(query) || desc.includes(query);
                    item.style.display = matches ? '' : 'none';
                });

                // Show/hide categories based on visible items
                categories.forEach(cat => {
                    const visibleItems = cat.querySelectorAll('.snippet-item:not([style*="display: none"])');
                    const content = cat.querySelector('.category-content');
                    const chevron = cat.querySelector('.category-chevron');
                    
                    if (query && visibleItems.length > 0) {
                        content.classList.remove('hidden');
                        chevron.style.transform = 'rotate(180deg)';
                    }
                    
                    cat.style.display = visibleItems.length > 0 || !query ? '' : 'none';
                });
            });
        }

        // General tab events (existing events)
        const darkBtn = container.querySelector('#theme-dark');
        const lightBtn = container.querySelector('#theme-light');
        const dawnBtn = container.querySelector('#theme-dawn');
        const oceanicBtn = container.querySelector('#theme-oceanic');
        const emberBtn = container.querySelector('#theme-ember');
        const auroraBtn = container.querySelector('#theme-aurora');
        const preview = container.querySelector('#theme-preview');
        const snippetToggle = container.querySelector('#autocomplete-snippets-toggle');

        const isLight = theme === 'light' || theme === 'dawn';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isEmber = theme === 'ember';
        const isAurora = theme === 'aurora';

        const getToggleClasses = (isOn) => {
            const buttonClass = `relative w-12 h-6 rounded-full transition-all ${isOn ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : ((isEmber || isAurora) ? 'bg-[#2c1c27]/70' : 'bg-white/10')))}`;
            const knobClass = `absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${isOn ? 'translate-x-6' : 'translate-x-0'}`;
            return { buttonClass, knobClass };
        };

        const applyToggleState = (isOn) => {
            if (!snippetToggle) return;
            const knob = snippetToggle.querySelector('span');
            const classes = getToggleClasses(isOn);
            snippetToggle.className = classes.buttonClass;
            if (knob) knob.className = classes.knobClass;
        };

        // Re-declaring updateButtons to include dawnBtn scope
        const updateAllButtons = (newTheme) => {
            const activeClass = 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30';
            const getInactiveClass = (t) => (t === 'light' || t === 'dawn') ? 'text-gray-600 hover:text-gray-800' : (t === 'oceanic' ? 'text-ocean-text/60 hover:text-ocean-text' : 'text-gray-400 hover:text-gray-200');
            const inactiveClass = getInactiveClass(newTheme);

            [darkBtn, lightBtn, dawnBtn, oceanicBtn, emberBtn, auroraBtn].forEach(btn => btn && (btn.className = `theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${inactiveClass}`));

            const activeBtn = newTheme === 'dark' ? darkBtn : (newTheme === 'light' ? lightBtn : (newTheme === 'dawn' ? dawnBtn : (newTheme === 'oceanic' ? oceanicBtn : (newTheme === 'ember' ? emberBtn : auroraBtn))));
            if (activeBtn) {
                activeBtn.className = `theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeClass}`;
            }

            if (newTheme === 'dark') preview.innerHTML = getDarkPreview();
            else if (newTheme === 'light') preview.innerHTML = getLightPreview();
            else if (newTheme === 'dawn') preview.innerHTML = getDawnPreview();
            else if (newTheme === 'oceanic') preview.innerHTML = getOceanicPreview();
            else if (newTheme === 'ember') preview.innerHTML = getEmberPreview();
            else preview.innerHTML = getAuroraPreview();
        };

        darkBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('dark');
            updateAllButtons('dark');
        });

        lightBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('light');
            updateAllButtons('light');
        });

        dawnBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('dawn');
            updateAllButtons('dawn');
        });

        oceanicBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('oceanic');
            updateAllButtons('oceanic');
        });

        emberBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('ember');
            updateAllButtons('ember');
        });

        auroraBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('aurora');
            updateAllButtons('aurora');
        });

        if (snippetToggle) {
            snippetToggle.addEventListener('click', () => {
                const current = SettingsManager.get('autocomplete.snippets', true);
                const next = !current;
                SettingsManager.set('autocomplete.snippets', next);
                applyToggleState(next);
            });
        }
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        container.className = `h-full overflow-auto ${getBgClass(theme)} transition-colors duration-300`;
        render();
        attachEvents();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    render();
    attachEvents();

    return container;
}

function getDarkPreview() {
    return `
        <div class="bg-[#0a0c10] p-4">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-red-500"></div>
                <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div class="w-3 h-3 rounded-full bg-green-500"></div>
                <span class="ml-2 text-xs text-gray-500">Dark Theme Preview</span>
            </div>
            <div class="bg-[#16191e] rounded-lg p-3 border border-white/5">
                <code class="text-sm font-mono">
                    <span class="text-cyan-400 font-semibold">SELECT</span>
                    <span class="text-gray-400"> * </span>
                    <span class="text-cyan-400 font-semibold">FROM</span>
                    <span class="text-yellow-400"> users</span>
                    <span class="text-gray-400">;</span>
                </code>
            </div>
        </div>
    `;
}

function getLightPreview() {
    return `
        <div class="bg-gray-50 p-4">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-red-500"></div>
                <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div class="w-3 h-3 rounded-full bg-green-500"></div>
                <span class="ml-2 text-xs text-gray-500">Light Theme Preview</span>
            </div>
            <div class="bg-white rounded-lg p-3 border border-gray-200">
                <code class="text-sm font-mono">
                    <span class="text-blue-600 font-semibold">SELECT</span>
                    <span class="text-gray-600"> * </span>
                    <span class="text-blue-600 font-semibold">FROM</span>
                    <span class="text-amber-600"> users</span>
                    <span class="text-gray-600">;</span>
                </code>
            </div>
        </div>
    `;
}

function getOceanicPreview() {
    return `
        <div class="bg-[#2E3440] p-4 oceanic">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-red-400"></div>
                <div class="w-3 h-3 rounded-full bg-yellow-400"></div>
                <div class="w-3 h-3 rounded-full bg-green-400"></div>
                <span class="ml-2 text-xs text-[#D8DEE9]">Oceanic Theme Preview</span>
            </div>
            <div class="bg-[#3B4252] rounded-lg p-3 border border-[#4C566A]">
                <code class="text-sm font-mono">
                    <span class="syntax-keyword font-semibold">SELECT</span>
                    <span class="text-[#D8DEE9]"> * </span>
                    <span class="syntax-keyword font-semibold">FROM</span>
                    <span class="syntax-string"> users</span>
                    <span class="text-[#D8DEE9]">;</span>
                </code>
            </div>
        </div>
    `;
}

function getDawnPreview() {
    return `
        <div class="bg-[#faf4ed] p-4 dawn">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-[#eb6f92]"></div>
                <div class="w-3 h-3 rounded-full bg-[#f6c177]"></div>
                <div class="w-3 h-3 rounded-full bg-[#31748f]"></div>
                <span class="ml-2 text-xs text-[#575279]">Dawn Theme Preview</span>
            </div>
            <div class="bg-[#fffaf3] rounded-lg p-3 border border-[#f2e9e1]">
                <code class="text-sm font-mono">
                    <span class="text-[#286983] font-semibold">SELECT</span>
                    <span class="text-[#575279]"> * </span>
                    <span class="text-[#286983] font-semibold">FROM</span>
                    <span class="text-[#d7827e]"> users</span>
                    <span class="text-[#575279]">;</span>
                </code>
            </div>
        </div>
    `;
}

function getEmberPreview() {
    return `
        <div class="bg-[#140c12] p-4 ember">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-[#f97316]"></div>
                <div class="w-3 h-3 rounded-full bg-[#fbbf24]"></div>
                <div class="w-3 h-3 rounded-full bg-[#f472b6]"></div>
                <span class="ml-2 text-xs text-[#c9b7c1]">Ember Theme Preview</span>
            </div>
            <div class="bg-[#1d141c] rounded-lg p-3 border border-[#2c1c27]">
                <code class="text-sm font-mono">
                    <span class="syntax-keyword font-semibold">SELECT</span>
                    <span class="text-[#f6eef2]"> * </span>
                    <span class="syntax-keyword font-semibold">FROM</span>
                    <span class="syntax-string"> users</span>
                    <span class="text-[#f6eef2]">;</span>
                </code>
            </div>
        </div>
    `;
}

function getAuroraPreview() {
    return `
        <div class="bg-[#0b1214] p-4 aurora">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-[#22d3ee]"></div>
                <div class="w-3 h-3 rounded-full bg-[#5eead4]"></div>
                <div class="w-3 h-3 rounded-full bg-[#34d399]"></div>
                <span class="ml-2 text-xs text-[#9bbcc3]">Aurora Theme Preview</span>
            </div>
            <div class="bg-[#0f1a1d] rounded-lg p-3 border border-[#1b2e33]">
                <code class="text-sm font-mono">
                    <span class="syntax-keyword font-semibold">SELECT</span>
                    <span class="text-[#e6f7f8]"> * </span>
                    <span class="syntax-keyword font-semibold">FROM</span>
                    <span class="syntax-string"> users</span>
                    <span class="text-[#e6f7f8]">;</span>
                </code>
            </div>
        </div>
    `;
}
