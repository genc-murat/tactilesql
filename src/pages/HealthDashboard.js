import { renderHealthDashboard } from '../components/Workbench/HealthDashboard.js';

export function HealthDashboardPage() {
    const wrapper = document.createElement('div');
    wrapper.className = 'h-full w-full flex flex-col bg-[var(--bg-secondary)]';
    
    const container = document.createElement('div');
    container.className = 'flex-1 overflow-hidden flex flex-col';
    wrapper.appendChild(container);
    
    renderHealthDashboard(container, null);
    
    return wrapper;
}
