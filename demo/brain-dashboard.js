import { createBrainDashboard } from '../src/ui-core/index.js';

const root = document.querySelector('#area52-root');
const dashboard = createBrainDashboard({ root });
globalThis.area52Dashboard = dashboard;
