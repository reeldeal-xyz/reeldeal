import '../src/styles/global.css';
import '../src/styles/market.css';
import '../src/styles/hmi.css';
import '../src/styles/weather-thresholds.css';
import '../src/styles/wallet.css';
import 'leaflet/dist/leaflet.css';
import '../src/components/molecules/relief/relief.css';
import './preview.css';

export default {
  initialGlobals: { viewport: { value: 'mobile390', isRotated: false } },
  parameters: {
    layout: 'padded',
    viewport: { options: {
      mobile320: { name: 'Mobile 320', styles: { width: '320px', height: '720px' }, type: 'mobile' },
      mobile390: { name: 'Mobile 390', styles: { width: '390px', height: '844px' }, type: 'mobile' },
      iphone17: { name: 'iPhone 17 · 402', styles: { width: '402px', height: '874px' }, type: 'mobile' },
      ipad: { name: 'iPad portrait', styles: { width: '820px', height: '1180px' }, type: 'tablet' },
      ipadLandscape: { name: 'iPad landscape', styles: { width: '1180px', height: '820px' }, type: 'tablet' },
      desktop1440: { name: 'Desktop 1440', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
    } },
    backgrounds: { options: {
      paper: { name: 'Paper', value: '#f2eddf' },
      blue: { name: 'Ocean', value: '#18b8ee' },
    } },
    options: { storySort: { order: ['ReelDeal', ['01 Atoms', '02 Molecules', '03 Organisms', '04 Pages']] } },
  },
};
