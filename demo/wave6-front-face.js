import { createWave5ProductFixture, createWave6ProductInterface } from '../src/ui-core/index.js';

const root=document.querySelector('#area52-wave6-root');
const ui=createWave6ProductInterface({
  root,
  fixture:createWave5ProductFixture(),
  productName:'Area-52',
  hostMountAdapter:{
    reserveWidth(width){document.documentElement.style.setProperty('--area52-demo-dock-width',`${width}px`);},
    releaseWidth(){document.documentElement.style.removeProperty('--area52-demo-dock-width');},
  },
});
globalThis.area52Wave6Demo=ui;
