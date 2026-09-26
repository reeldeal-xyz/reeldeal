import '../src/styles/global.css';
import '../src/styles/market.css';
import './preview.css';

export default {
  initialGlobals: { viewport: { value: 'mobile390', isRotated: false } },
  parameters: {
    layout: 'padded',
    viewport: { options: {
      mobile320: { name: 'Mobile 320', styles: { width: '320px', height: '720px' }, type: 'mobile' },
      mobile390: { name: 'Mobile 390', styles: { width: '390px', height: '844px' }, type: 'mobile' },
      desktop1440: { name: 'Desktop 1440', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
    } },
    backgrounds: { options: {
      paper: { name: 'Paper', value: '#f2eddf' },
      blue: { name: 'Ocean', value: '#18b8ee' },
    } },
    options: { storySort: { order: ['ReelDeal', ['01 Atoms', '02 Molecules', '03 Organisms', '04 Pages']] } },
  },
};
