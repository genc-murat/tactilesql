import { MainLayout } from '../components/Layout/MainLayout.js';
import { KPISection } from '../components/Dashboard/KPISection.js';
import { ClusterOverview } from '../components/Dashboard/ClusterOverview.js';
import { QueryTable } from '../components/Dashboard/QueryTable.js';

export function Dashboard() {
    const content = [
        KPISection(),
        ClusterOverview(),
        QueryTable()
    ];

    return MainLayout(content);
}
