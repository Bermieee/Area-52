import { FrontFaceMode, ProductDetailLevel, createWave6ProductInterface } from '../src/ui-core/index.js';
import { wave8RetrievalHeavyFixture } from '../tests/fixtures/wave8-cognition-fixtures.mjs';

const root=document.querySelector('#area52-wave8-root');
const ui=createWave6ProductInterface({
  root,
  productName:'Area-52',
  productTagline:'Cognitive Story System',
  bridges:{cognition:{fixture:wave8RetrievalHeavyFixture()}},
  hostMountAdapter:{
    reserveWidth(width){document.documentElement.style.setProperty('--area52-wave8-dock-width',`${width}px`);},
    releaseWidth(){document.documentElement.style.removeProperty('--area52-wave8-dock-width');},
  },
});
ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:900});
ui.productAdapter.setDetailLevel(ProductDetailLevel.NORMAL);
ui.shell.selectWorkspace('brain');
globalThis.area52Wave8Demo=ui;
