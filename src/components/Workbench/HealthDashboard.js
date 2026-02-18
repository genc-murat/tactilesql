import { HealthScoreApi } from '../../api/healthScore.js';
import { toastError, toastSuccess } from '../../utils/Toast.js';
import { HealthAiModal } from '../UI/HealthAiModal.js';

export function renderHealthDashboard(container, connection) {
    container.innerHTML = '';

    let healthReport = null;
    let recommendations = [];
    let selectedCategory = null;
    let filterSeverity = 'all';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-emerald-500 text-xl">monitoring</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Health Dashboard</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Database Health Score & Recommendations</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button id="ai-analysis-btn" class="px-3 py-1.5 bg-purple-500/10 text-purple-400 rounded text-xs hover:bg-purple-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-purple-500/20">
                <span class="material-symbols-outlined text-sm">auto_awesome</span> AI Analysis
            </button>
            <select id="severity-filter" class="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-xs rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500/50">
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
            </select>
            <button id="refresh-health" class="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 rounded text-xs hover:bg-emerald-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-emerald-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-6';
    container.appendChild(contentArea);

    const loadData = async () => {
        contentArea.innerHTML = `
            <div class="absolute inset-0 flex items-center justify-center">
                <span class="animate-spin material-symbols-outlined text-4xl text-emerald-500">progress_activity</span>
            </div>
        `;
        
        try {
            const [report, recs] = await Promise.all([
                HealthScoreApi.getHealthReport(),
                HealthScoreApi.getRecommendations(),
            ]);
            
            healthReport = report;
            recommendations = recs;
            renderDashboard();
        } catch (error) {
            if (error.includes('not yet implemented')) {
                contentArea.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-64 text-center">
                        <span class="material-symbols-outlined text-6xl text-[var(--text-secondary)] opacity-50">code</span>
                        <h3 class="mt-4 text-lg font-bold text-[var(--text-primary)]">Coming Soon</h3>
                        <p class="mt-2 text-sm text-[var(--text-secondary)]">${error}</p>
                    </div>
                `;
            } else {
                contentArea.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load health report: ${error}</div>`;
                toastError(`Failed to load health report: ${error}`);
            }
        }
    };

    const getScoreColor = (score) => {
        if (score >= 90) return 'emerald';
        if (score >= 80) return 'blue';
        if (score >= 70) return 'yellow';
        if (score >= 60) return 'orange';
        return 'red';
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'healthy': return 'emerald';
            case 'warning': return 'yellow';
            case 'critical': return 'red';
            default: return 'gray';
        }
    };

    const getSeverityIcon = (severity) => {
        switch (severity) {
            case 'critical': return 'dangerous';
            case 'high': return 'warning';
            case 'medium': return 'info';
            default: return 'info_i';
        }
    };

    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'critical': return 'red';
            case 'high': return 'orange';
            case 'medium': return 'yellow';
            default: return 'blue';
        }
    };

    const getTrendIcon = (trend) => {
        switch (trend) {
            case 'improving': return 'trending_up';
            case 'declining': return 'trending_down';
            default: return 'flatware';
        }
    };

    const renderDashboard = () => {
        if (!healthReport) return;
        
        contentArea.innerHTML = '';
        
        const topSection = document.createElement('div');
        topSection.className = 'grid grid-cols-3 gap-6';
        
        const scoreCard = document.createElement('div');
        scoreCard.className = 'bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-6 shadow-sm';
        const scoreColor = getScoreColor(healthReport.overall_score);
        
        scoreCard.innerHTML = `
            <div class="flex flex-col items-center">
                <h3 class="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">Overall Health Score</h3>
                <div class="relative w-32 h-32">
                    <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" stroke="var(--bg-tertiary)" stroke-width="8" fill="none"/>
                        <circle cx="50" cy="50" r="45" stroke="${scoreColor === 'emerald' ? '#10b981' : scoreColor === 'blue' ? '#3b82f6' : scoreColor === 'yellow' ? '#eab308' : scoreColor === 'orange' ? '#f97316' : '#ef4444'}" 
                            stroke-width="8" fill="none" 
                            stroke-linecap="round"
                            stroke-dasharray="${healthReport.overall_score * 2.83} 283"
                            class="transition-all duration-1000"/>
                    </svg>
                    <div class="absolute inset-0 flex flex-col items-center justify-center">
                        <span class="text-3xl font-black text-${scoreColor}-500">${healthReport.overall_score}</span>
                        <span class="text-xs font-bold text-[var(--text-secondary)]">${healthReport.grade}</span>
                    </div>
                </div>
                <div class="mt-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm ${healthReport.trend === 'improving' ? 'text-emerald-500' : healthReport.trend === 'declining' ? 'text-red-500' : 'text-[var(--text-secondary)]'}">${getTrendIcon(healthReport.trend)}</span>
                    <span class="text-xs text-[var(--text-secondary)] capitalize">${healthReport.trend}</span>
                </div>
            </div>
        `;
        topSection.appendChild(scoreCard);
        
        const statsCard = document.createElement('div');
        statsCard.className = 'bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-6 shadow-sm';
        statsCard.innerHTML = `
            <h3 class="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">Issues Summary</h3>
            <div class="space-y-4">
                <div class="flex items-center justify-between p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-red-500">dangerous</span>
                        <span class="text-sm text-[var(--text-primary)]">Critical Issues</span>
                    </div>
                    <span class="text-xl font-black text-red-500">${healthReport.critical_issues}</span>
                </div>
                <div class="flex items-center justify-between p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-yellow-500">warning</span>
                        <span class="text-sm text-[var(--text-primary)]">Warnings</span>
                    </div>
                    <span class="text-xl font-black text-yellow-500">${healthReport.warnings}</span>
                </div>
                <div class="flex items-center justify-between p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-emerald-500">check_circle</span>
                        <span class="text-sm text-[var(--text-primary)]">Healthy Metrics</span>
                    </div>
                    <span class="text-xl font-black text-emerald-500">${countHealthyMetrics()}</span>
                </div>
            </div>
        `;
        topSection.appendChild(statsCard);
        
        const quickActionsCard = document.createElement('div');
        quickActionsCard.className = 'bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-6 shadow-sm';
        quickActionsCard.innerHTML = `
            <h3 class="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">Quick Actions</h3>
            <div class="space-y-3">
                <button id="view-top-recommendations" class="w-full flex items-center gap-3 p-3 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg border border-purple-500/20 transition-all text-left">
                    <span class="material-symbols-outlined text-purple-500">lightbulb</span>
                    <div>
                        <p class="text-sm font-bold text-[var(--text-primary)]">Top Recommendations</p>
                        <p class="text-[10px] text-[var(--text-secondary)]">${recommendations.length} actionable items</p>
                    </div>
                </button>
                <button id="export-health-report" class="w-full flex items-center gap-3 p-3 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg border border-blue-500/20 transition-all text-left">
                    <span class="material-symbols-outlined text-blue-500">download</span>
                    <div>
                        <p class="text-sm font-bold text-[var(--text-primary)]">Export Report</p>
                        <p class="text-[10px] text-[var(--text-secondary)]">Download as JSON</p>
                    </div>
                </button>
                <button id="schedule-checkup" class="w-full flex items-center gap-3 p-3 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg border border-emerald-500/20 transition-all text-left">
                    <span class="material-symbols-outlined text-emerald-500">schedule</span>
                    <div>
                        <p class="text-sm font-bold text-[var(--text-primary)]">Schedule Checkup</p>
                        <p class="text-[10px] text-[var(--text-secondary)]">Set up regular monitoring</p>
                    </div>
                </button>
            </div>
        `;
        topSection.appendChild(quickActionsCard);
        
        contentArea.appendChild(topSection);
        
        const categoriesSection = document.createElement('div');
        categoriesSection.innerHTML = `
            <h3 class="text-sm font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-[var(--text-secondary)]">category</span>
                Health Categories
            </h3>
            <div class="grid grid-cols-5 gap-4">
                ${healthReport.categories.map(cat => {
                    const catColor = getStatusColor(cat.status);
                    return `
                        <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm cursor-pointer hover:border-${catColor}-500/50 transition-all category-card" data-category="${cat.id}">
                            <div class="flex items-center gap-3 mb-3">
                                <div class="w-8 h-8 rounded-lg bg-${catColor}-500/10 flex items-center justify-center">
                                    <span class="material-symbols-outlined text-${catColor}-500 text-lg">${cat.icon}</span>
                                </div>
                                <div class="flex-1">
                                    <p class="text-xs font-bold text-[var(--text-primary)]">${cat.name}</p>
                                    <p class="text-[10px] text-[var(--text-secondary)]">${cat.metrics.length} metrics</p>
                                </div>
                            </div>
                            <div class="flex items-center justify-between">
                                <div class="flex-1 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                                    <div class="h-full bg-${catColor}-500 transition-all" style="width: ${cat.score}%"></div>
                                </div>
                                <span class="ml-3 text-sm font-black text-${catColor}-500">${cat.score}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        contentArea.appendChild(categoriesSection);
        
        if (healthReport.critical_issues > 0) {
            const criticalSection = document.createElement('div');
            const criticalMetrics = getCriticalMetrics();
            
            criticalSection.innerHTML = `
                <div class="bg-red-500/5 rounded-xl border border-red-500/20 p-4">
                    <div class="flex items-center gap-2 mb-4">
                        <span class="material-symbols-outlined text-red-500 animate-pulse">dangerous</span>
                        <h3 class="text-sm font-bold text-red-500">Critical Issues Detected</h3>
                    </div>
                    <div class="space-y-2">
                        ${criticalMetrics.map(m => `
                            <div class="flex items-center justify-between p-3 bg-[var(--bg-primary)] rounded-lg border border-red-500/10">
                                <div>
                                    <p class="text-sm font-bold text-[var(--text-primary)]">${m.label}</p>
                                    <p class="text-[10px] text-[var(--text-secondary)]">${m.description || 'Requires immediate attention'}</p>
                                </div>
                                <span class="text-sm font-mono font-bold text-red-500">${m.value}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            contentArea.appendChild(criticalSection);
        }
        
        const recommendationsSection = document.createElement('div');
        recommendationsSection.className = 'bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] shadow-sm overflow-hidden';
        
        const filteredRecs = filterSeverity === 'all' 
            ? recommendations 
            : recommendations.filter(r => r.severity === filterSeverity);
        
        recommendationsSection.innerHTML = `
            <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/30 flex items-center justify-between">
                <h3 class="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <span class="material-symbols-outlined text-[var(--text-secondary)]">lightbulb</span>
                    Recommendations
                    <span class="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">${filteredRecs.length}</span>
                </h3>
            </div>
            <div class="divide-y divide-[var(--border-color)]/30 max-h-80 overflow-auto">
                ${filteredRecs.length === 0 ? `
                    <div class="p-8 text-center text-[var(--text-secondary)]">
                        <span class="material-symbols-outlined text-4xl opacity-50">check_circle</span>
                        <p class="mt-2 text-sm">No recommendations for this filter</p>
                    </div>
                ` : filteredRecs.map(rec => {
                    const sevColor = getSeverityColor(rec.severity);
                    return `
                        <div class="p-4 hover:bg-[var(--bg-tertiary)]/20 transition-all recommendation-item">
                            <div class="flex items-start gap-3">
                                <div class="w-6 h-6 rounded-full bg-${sevColor}-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span class="material-symbols-outlined text-${sevColor}-500 text-sm">${getSeverityIcon(rec.severity)}</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2">
                                        <p class="text-sm font-bold text-[var(--text-primary)]">${rec.title}</p>
                                        <span class="text-[9px] px-1.5 py-0.5 bg-${sevColor}-500/10 text-${sevColor}-500 rounded uppercase font-bold">${rec.severity}</span>
                                    </div>
                                    <p class="text-xs text-[var(--text-secondary)] mt-1">${rec.description}</p>
                                    <div class="flex items-center gap-4 mt-2">
                                        <span class="text-[10px] text-emerald-500">
                                            <span class="material-symbols-outlined text-[10px] align-middle">trending_up</span>
                                            ${rec.impact}
                                        </span>
                                        <span class="text-[10px] text-[var(--text-secondary)]">
                                            Effort: ${rec.effort}
                                        </span>
                                    </div>
                                    ${rec.action_sql ? `
                                        <div class="mt-3 p-2 bg-[var(--bg-tertiary)]/50 rounded text-[10px] font-mono text-[var(--text-secondary)] overflow-x-auto">
                                            ${rec.action_sql}
                                        </div>
                                    ` : ''}
                                </div>
                                <div class="flex flex-col gap-1.5">
                                    <button class="ai-fix-recommendation px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded text-[10px] font-bold uppercase transition-all flex items-center gap-1" data-rec-id="${rec.id}" title="Get detailed AI fix guide">
                                        <span class="material-symbols-outlined text-sm">auto_awesome</span>
                                    </button>
                                    ${rec.action_sql ? `
                                        <button class="apply-recommendation px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold uppercase transition-all" data-rec-id="${rec.id}">
                                            Apply
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        contentArea.appendChild(recommendationsSection);
        
        if (healthReport.previous_scores && healthReport.previous_scores.length > 0) {
            const trendSection = document.createElement('div');
            trendSection.className = 'bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-6 shadow-sm';
            trendSection.innerHTML = `
                <h3 class="text-sm font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-[var(--text-secondary)]">show_chart</span>
                    30-Day Score Trend
                </h3>
                <div class="h-32 flex items-end gap-1">
                    ${healthReport.previous_scores.slice(0, 30).reverse().map((point, idx) => {
                        const color = getScoreColor(point.score);
                        const height = point.score;
                        return `
                            <div class="flex-1 bg-${color}-500/50 hover:bg-${color}-500 rounded-t min-w-[4px] transition-all relative group" style="height: ${height}%">
                                <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black text-white text-[9px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 pointer-events-none">
                                    ${point.score} (${point.grade})<br>
                                    ${point.date ? new Date(point.date).toLocaleDateString() : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
            contentArea.appendChild(trendSection);
        }
        
        attachEventListeners();
    };

    const countHealthyMetrics = () => {
        if (!healthReport) return 0;
        let count = 0;
        healthReport.categories.forEach(cat => {
            cat.metrics.forEach(m => {
                if (m.status === 'healthy') count++;
            });
        });
        return count;
    };

    const getCriticalMetrics = () => {
        if (!healthReport) return [];
        const critical = [];
        healthReport.categories.forEach(cat => {
            cat.metrics.forEach(m => {
                if (m.status === 'critical') {
                    critical.push(m);
                }
            });
        });
        return critical;
    };

    const attachEventListeners = () => {
        header.querySelector('#refresh-health')?.addEventListener('click', loadData);
        
        header.querySelector('#ai-analysis-btn')?.addEventListener('click', () => {
            if (healthReport) {
                HealthAiModal.show(healthReport, recommendations, connection);
            }
        });
        
        header.querySelector('#severity-filter')?.addEventListener('change', (e) => {
            filterSeverity = e.target.value;
            renderDashboard();
        });
        
        contentArea.querySelectorAll('.category-card').forEach(card => {
            card.addEventListener('click', () => {
                const categoryId = card.dataset.category;
                showCategoryDetail(categoryId);
            });
        });
        
        contentArea.querySelectorAll('.apply-recommendation').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const recId = btn.dataset.recId;
                btn.disabled = true;
                btn.innerHTML = '<span class="animate-spin material-symbols-outlined text-sm">progress_activity</span>';
                
                try {
                    const result = await HealthScoreApi.applyRecommendation(recId);
                    if (result.success) {
                        toastSuccess(result.message);
                        await loadData();
                    } else {
                        toastError(result.message);
                        btn.disabled = false;
                        btn.innerHTML = 'Apply';
                    }
                } catch (error) {
                    toastError(`Failed to apply: ${error}`);
                    btn.disabled = false;
                    btn.innerHTML = 'Apply';
                }
            });
        });

        contentArea.querySelectorAll('.ai-fix-recommendation').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const recId = btn.dataset.recId;
                const rec = recommendations.find(r => r.id === recId);
                if (!rec) return;

                btn.disabled = true;
                btn.innerHTML = '<span class="animate-spin material-symbols-outlined text-sm">progress_activity</span>';

                try {
                    const dbType = localStorage.getItem('activeDbType') || 'mysql';
                    const fixGuide = await HealthAiModal.generateFix(rec, healthReport, dbType);
                    
                    const modal = document.createElement('div');
                    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';
                    modal.innerHTML = `
                        <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                            <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-between rounded-t-xl">
                                <div class="flex items-center gap-3">
                                    <span class="material-symbols-outlined text-purple-500">auto_awesome</span>
                                    <h3 class="font-bold text-[var(--text-primary)]">AI Fix Guide: ${rec.title}</h3>
                                </div>
                                <button class="close-fix-modal text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                                    <span class="material-symbols-outlined">close</span>
                                </button>
                            </div>
                            <div class="flex-1 overflow-auto p-6 prose prose-sm max-w-none prose-invert">
                                ${fixGuide}
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modal);

                    modal.querySelector('.close-fix-modal').addEventListener('click', () => modal.remove());
                    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

                } catch (error) {
                    toastError(`Failed to generate fix: ${error.message}`);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="material-symbols-outlined text-sm">auto_awesome</span>';
                }
            });
        });
        
        contentArea.querySelector('#export-health-report')?.addEventListener('click', () => {
            const dataStr = JSON.stringify(healthReport, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `health-report-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toastSuccess('Report exported successfully');
        });
        
        contentArea.querySelector('#view-top-recommendations')?.addEventListener('click', () => {
            recommendationsSection.scrollIntoView({ behavior: 'smooth' });
        });
    };

    const showCategoryDetail = (categoryId) => {
        const category = healthReport?.categories.find(c => c.id === categoryId);
        if (!category) return;
        
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
                <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-${getStatusColor(category.status)}-500">${category.icon}</span>
                        <h3 class="font-bold text-[var(--text-primary)]">${category.name} Details</h3>
                    </div>
                    <button class="close-modal text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="p-6 overflow-auto max-h-[calc(80vh-80px)]">
                    <div class="mb-6 flex items-center gap-4">
                        <div class="text-center">
                            <div class="text-4xl font-black text-${getStatusColor(category.status)}-500">${category.score}</div>
                            <div class="text-xs text-[var(--text-secondary)]">Score</div>
                        </div>
                        <div class="flex-1 h-4 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                            <div class="h-full bg-${getStatusColor(category.status)}-500" style="width: ${category.score}%"></div>
                        </div>
                    </div>
                    <div class="space-y-3">
                        ${category.metrics.map(m => `
                            <div class="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-sm font-bold text-[var(--text-primary)]">${m.label}</span>
                                    <div class="flex items-center gap-2">
                                        <span class="text-sm font-mono font-bold text-${getStatusColor(m.status)}-500">${m.value}</span>
                                        <span class="w-2 h-2 rounded-full bg-${getStatusColor(m.status)}-500"></span>
                                    </div>
                                </div>
                                ${m.description ? `<p class="text-[10px] text-[var(--text-secondary)]">${m.description}</p>` : ''}
                                <div class="mt-2 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                                    <div class="h-full bg-${getStatusColor(m.status)}-500" style="width: ${Math.min(100, Math.max(0, calculateMetricPercent(m)))}%"></div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        
        modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        document.body.appendChild(modal);
    };

    const calculateMetricPercent = (metric) => {
        if (metric.threshold_warning === undefined || metric.threshold_critical === undefined) {
            return metric.status === 'healthy' ? 100 : metric.status === 'warning' ? 50 : 20;
        }
        
        if (metric.raw_value >= metric.threshold_critical) {
            return 100;
        } else if (metric.raw_value >= metric.threshold_warning) {
            const ratio = (metric.raw_value - metric.threshold_warning) / (metric.threshold_critical - metric.threshold_warning);
            return 50 + ratio * 50;
        } else {
            const ratio = metric.raw_value / metric.threshold_warning;
            return ratio * 50;
        }
    };

    loadData();
}
