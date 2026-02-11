/**
 * Lightweight SVG Charting Utility
 * Optimized for real-time database metric visualization
 */

export const Charting = {
    /**
     * Renders a simple line chart into a container
     * @param {HTMLElement} container 
     * @param {Array<number>} data - Array of numeric values
     * @param {Object} options 
     */
    renderLineChart(container, data, options = {}) {
        if (!container) return;
        
        const {
            width = container.clientWidth || 400,
            height = container.clientHeight || 120,
            color = '#00c8ff',
            fillColor = 'rgba(0, 200, 255, 0.1)',
            lineWidth = 2,
            maxPoints = 60,
            showArea = true
        } = options;

        if (data.length < 2) {
            container.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500 text-xs italic">Gathering data...</div>';
            return;
        }

        // Slice data to max points
        const points = data.slice(-maxPoints);
        const maxVal = Math.max(...points, 1); // Ensure at least 1 to avoid div by zero
        const minVal = Math.min(...points);
        
        // Dynamic range with some padding
        const range = maxVal - minVal;
        const padding = range * 0.1;
        const top = maxVal + padding;
        const bottom = Math.max(0, minVal - padding);
        const yRange = top - bottom || 1;

        // Calculate SVG points
        const stepX = width / (maxPoints - 1);
        const svgPoints = points.map((val, i) => {
            const x = i * stepX;
            const y = height - ((val - bottom) / yRange * height);
            return `${x},${y}`;
        });

        const pathD = `M ${svgPoints.join(' L ')}`;
        const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;

        container.innerHTML = `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="overflow-visible">
                ${showArea ? `<path d="${areaD}" fill="${fillColor}" />` : ''}
                <path d="${pathD}" fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-linejoin="round" stroke-linecap="round" />
            </svg>
        `;
    },

    /**
     * Generates a sparkline SVG string
     * @param {Array<number>} data 
     * @param {string} color 
     * @returns {string} SVG HTML string
     */
    getSparkline(data, color = '#00c8ff') {
        if (!data || data.length < 2) return '';
        
        const width = 60;
        const height = 20;
        const points = data.slice(-10); // Last 10 points for sparkline
        const max = Math.max(...points, 1);
        const min = Math.min(...points);
        const range = max - min || 1;

        const stepX = width / (points.length - 1);
        const svgPoints = points.map((val, i) => {
            const x = i * stepX;
            const y = height - ((val - min) / range * height);
            return `${x},${y}`;
        });

        return `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display: inline-block; vertical-align: middle;">
                <path d="M ${svgPoints.join(' L ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            </svg>
        `;
    }
};
