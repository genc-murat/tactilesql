/**
 * Context Menu Utility
 * Centralizes context menu creation, styling, and management.
 */

import { ThemeManager } from './ThemeManager.js';

let activeMenu = null;
let activeCleanup = null;

/**
 * Creates and displays a context menu at the specified coordinates.
 * @param {number} x - The x-coordinate for the menu.
 * @param {number} y - The y-coordinate for the menu.
 * @param {Array} items - Array of menu items. Each item can be a button object or a separator/header.
 *                        Item format:
 *                        {
 *                          type: 'button' | 'separator' | 'header' | 'submenu',
 *                          label: string, // For buttons and headers
 *                          icon: string,  // Material symbol name
 *                          iconColor: string, // Tailwind class for icon color
 *                          onClick: function, // Click handler for buttons
 *                          id: string,    // Optional ID
 *                          items: Array,  // For submenus
 *                        }
 * @param {Object} options - Optional configuration
 * @param {string} options.header - Optional header text for the menu
 * @param {string} options.headerColor - Optional text color class for the header
 */
export const createContextMenu = (x, y, items, options = {}) => {
    // Remove existing menu if any
    removeContextMenu();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isNeon = theme === 'neon';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

    const menu = document.createElement('div');
    menu.id = 'tactilesql-context-menu';

    // Theme-based styles
    const bgClass = isLight ? 'bg-white border-gray-200 shadow-lg' :
        (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] shadow-lg shadow-[#ea9d34]/10' :
            (isOceanic ? 'bg-ocean-panel border border-ocean-border/50 shadow-xl' :
                (isNeon ? 'bg-[#050510] border-neon-border/50 text-neon-text shadow-[0_0_15px_rgba(0,243,255,0.15)]' :
                    'bg-[#1a1d23] border border-white/10 shadow-xl')));

    const dividerColor = isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5');
    const headerTextClass = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500');
    const hoverClass = isLight ? 'hover:bg-gray-50 text-gray-700' :
        (isDawn ? 'hover:bg-[#faf4ed] text-[#575279]' :
            (isNeon ? 'hover:bg-neon-accent/10 text-neon-text hover:text-neon-cyan' :
                'hover:bg-white/5 text-gray-300 hover:text-white'));

    menu.className = `fixed z-[9999] ${bgClass} rounded-lg py-1 w-48 animate-scale-in origin-top-left`;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Ensure all items have IDs for event lookup
    const assignIds = (list) => {
        list.forEach(item => {
            if (!item.id) {
                item.id = `ctx-item-${Math.random().toString(36).substr(2, 9)}`;
            }
            if (item.items) {
                assignIds(item.items);
            }
        });
    };
    assignIds(items);

    // Render configuration
    let content = '';

    // Header
    if (options.header) {
        content += `<div class="px-3 py-1.5 text-[10px] font-mono ${options.headerColor || headerTextClass} ${dividerColor} border-b tracking-widest mb-1 truncate" title="${options.header}">
            ${options.header}
        </div>`;
    }

    // Items
    const renderItems = (menuItems) => {
        return menuItems.map(item => {
            if (item.type === 'separator') {
                return `<div class="h-px ${dividerColor} my-1 mx-2"></div>`;
            }

            if (item.type === 'header') {
                return `<div class="px-3 py-1 text-[9px] font-bold ${headerTextClass} uppercase tracking-wider mt-1 mb-0.5">${item.label}</div>`;
            }

            if (item.type === 'submenu') {
                // Submenu logic can be complex for basic implementation, handling simpler nested divs or simple hover expansion
                // For now, let's implement a structure that supports CSS-based hover or simple click
                // We'll use a group and absolute positioning
                const submenuId = `submenu-${Math.random().toString(36).substring(7)}`;
                return `
                    <div class="relative group/submenu w-full">
                        <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${hoverClass} flex items-center justify-between transition-colors duration-150">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm ${item.iconColor || 'text-gray-400'}">${item.icon || 'circle'}</span> ${item.label}
                            </div>
                            <span class="material-symbols-outlined text-[10px]">chevron_right</span>
                        </button>
                        <div class="hidden group-hover/submenu:block absolute left-full top-0 ml-1 w-40 rounded-lg py-1 ${bgClass} shadow-xl border ${dividerColor}">
                            ${item.items.map(subItem => {
                    if (subItem.type === 'separator') return `<div class="h-px ${dividerColor} my-1 mx-2"></div>`;
                    return `
                                    <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${hoverClass} flex items-center gap-2 transition-colors duration-150" id="${subItem.id || ''}" data-action="${subItem.action || ''}">
                                        <span class="material-symbols-outlined text-sm ${subItem.iconColor || 'text-gray-400'}">${subItem.icon || 'circle'}</span> ${subItem.label}
                                    </button>
                                `;
                }).join('')}
                        </div>
                    </div>
                `;
            }

            // Standard Button
            return `
                <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${hoverClass} flex items-center gap-2 transition-colors duration-150" id="${item.id || ''}" data-action="${item.action || ''}">
                    <span class="material-symbols-outlined text-sm ${item.iconColor || 'text-gray-400'}">${item.icon || 'circle'}</span> ${item.label}
                </button>
            `;
        }).join('');
    };

    content += renderItems(items);
    menu.innerHTML = content;
    document.body.appendChild(menu);

    activeMenu = menu;

    // Adjust position if out of bounds
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }

    // Attach Event Listeners
    // Attach Event Listeners
    const handleClick = (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        // Check if it's a submenu parent (don't close menu)
        if (button.nextElementSibling && button.nextElementSibling.classList.contains('group-hover/submenu:block')) {
            return;
        }

        const action = button.dataset.action;
        const id = button.id;

        // Find the item object to trigger onClick
        // We need to traverse nested items too
        const findItem = (list) => {
            for (const item of list) {
                if ((id && item.id === id) || (action && item.action === action)) return item;
                if (item.items) {
                    const found = findItem(item.items);
                    if (found) return found;
                }
            }
            return null;
        };

        const item = findItem(items);
        if (item && item.onClick) {
            item.onClick(e);
            removeContextMenu();
        }
    };

    menu.addEventListener('click', handleClick);

    // Cleanup Listener
    const closeMenu = (e) => {
        if (activeMenu && !activeMenu.contains(e.target)) {
            removeContextMenu();
        }
    };

    // Delay adding the click listener to avoid immediate closing if triggered by click
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('contextmenu', closeMenu);
        activeCleanup = () => {
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('contextmenu', closeMenu);
        };
    }, 0);
};

export const removeContextMenu = () => {
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
    if (activeCleanup) {
        activeCleanup();
        activeCleanup = null;
    }
};
